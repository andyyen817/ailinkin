import 'server-only';
import {promises as fs} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Campaign} from '@/domain/research';
import {withTenant} from './tenant';
import {campaign} from './research-store';
import {AccessError} from './policy';
import {putContactImage,readContactImage} from './contact-evidence-store';
import {contactScope,checkContactScope,executeContactResearch} from '../../scripts/research/contact-research.mjs';
export const contactExecuteInput=z.object({action:z.literal('run'),campaignId:z.uuid(),planId:z.string().regex(/^CR-[a-f0-9]{24}$/),
  companyId:z.string().regex(/^C-[a-f0-9-]{36}$/),platform:z.string().max(30),url:z.url().max(2000)}).strict();
type Input=z.infer<typeof contactExecuteInput>;
export async function readContactScope(){
  try{return contactScope.parse(JSON.parse(await fs.readFile(/* turbopackIgnore: true */ process.env.CONTACT_RESEARCH_SCOPE_PATH||'.runtime/contact-research-scope.json','utf8')));}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw new AccessError('CONTACT_SCOPE_INVALID',403);}
}
export function contactTarget(row:Campaign,tenantId:string,input:Input){
  if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId||row.id!==input.campaignId)throw new AccessError('SEARCH_NOT_FOUND',404);
  const plan=row.data.contactResearchPlans?.find((p:any)=>p.id===input.planId),entry=plan?.companies.find((c:any)=>c.companyId===input.companyId);
  const company=row.data.companies.find((c:any)=>c.id===input.companyId&&c.qualification?.status==='qualified');
  const account=entry?.accounts.find((a:any)=>a.platform===input.platform&&a.url===input.url);
  if(!company||!account||company.website!==entry.website||account.sourceExpired)throw new AccessError('CONTACT_ACCOUNT_NOT_READY',409);
  if(!row.data.project.buyerGroup?.ready)throw new AccessError('CURRENT_COMPANY_ANALYSIS_REQUIRED',409);
  return {company,account};
}
export async function contactExecutionStatus(row:Campaign,tenantId:string){
  const scope=await readContactScope();let enabled=false,reason='CONTACT_SCOPE_REQUIRED';
  if(scope)try{checkContactScope(scope,{tenantId,campaignId:row.id,companyId:scope.companyId,platform:scope.platform,url:scope.url});enabled=true;reason='READY';}catch{reason='CONTACT_SCOPE_EXPIRED_OR_MISMATCH';}
  return {enabled,reason,scope:enabled?scope:null,runs:row.data.contactResearchRuns||[],sent:0};
}
export async function runContactExecution(request:Request,tenantId:string,raw:unknown){
  const input=contactExecuteInput.parse(raw),scope=await readContactScope();
  if(!scope)throw new AccessError('CONTACT_SCOPE_REQUIRED',403);
  try{checkContactScope(scope,{tenantId,campaignId:input.campaignId,companyId:input.companyId,platform:input.platform,url:input.url});}
  catch{throw new AccessError('CONTACT_SCOPE_EXPIRED_OR_MISMATCH',403);}
  if(scope.modelRequests&&!process.env.DEEPSEEK_API_KEY)throw new AccessError('CONTACT_MODEL_KEY_MISSING',409);
  const token=randomUUID();
  const {row,target,previousState}=await withTenant(request,tenantId,async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':contact-execute:'+input.campaignId}))`;
    const row=await campaign(tx,input.campaignId),target=contactTarget(row,tenantId,input);
    if(row.state==='running'||row.data.operatorLease||row.data.contactLease)throw new AccessError('CONTACT_RESEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
    if(row.data.requests.some((q:any)=>['pending','unknown'].includes(q.status))||(row.data.contactResearchRuns||[]).some((r:any)=>r.requests.some((q:any)=>['pending','unknown'].includes(q.status))))throw new AccessError('CONTACT_REQUEST_UNKNOWN',409);
    const previousState=row.state;row.data.contactLease={token,startedAt:new Date().toISOString(),scopeId:scope.id};
    const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state='running',lease_token=${token},lease_until=now()+interval '3 minutes',version=version+1,updated_at=now()
      WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version} AND state<>'running'`;
    if(n!==1)throw new AccessError('SEARCH_VERSION_CONFLICT',409);row.version++;return {row,target,previousState};
  },true);
  const save=async(finished=false)=>withTenant(request,tenantId,async tx=>{
    const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state=${finished?previousState:'running'},
      lease_token=${finished?null:token},lease_until=${finished?null:new Date(Date.now()+180000)},version=version+1,updated_at=now()
      WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version} AND lease_token=${token}`;
    if(n!==1)throw new AccessError('CONTACT_CHECKPOINT_CONFLICT',409);row.version++;
  },true);
  try{
    const result=await executeContactResearch(row.data,{tenantId,campaignId:row.id,...target,scope},()=>save(),{
      keys:{DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY},putImage:(b:Buffer)=>putContactImage(tenantId,b),loadImage:(id:string)=>readContactImage(tenantId,id)});
    delete row.data.contactLease;await save(true);return result;
  }catch(e){delete row.data.contactLease;await save(true).catch(()=>{});throw e;}
}
