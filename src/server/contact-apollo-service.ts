import 'server-only';
import fs from 'node:fs/promises';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {withTenant} from './tenant';
import {campaign} from './research-store';
import {enterpriseSelectionView} from './enterprise-selection';
import {AccessError} from './policy';
import {sharedBudgetGuard} from './shared-research-budget';
import {sharedResearchBudget} from '@/domain/shared-research-budget';
import {transport} from '../../scripts/research/http.mjs';
const scopeSchema=z.object({enabled:z.literal(true),tenantId:z.uuid(),campaignId:z.uuid(),selectionId:z.string(),companyIds:z.array(z.string()).min(1).max(3),
  approvedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),maxRequests:z.literal(3),maxCredits:z.literal(5),send:z.literal(false),sharedBudget:sharedResearchBudget}).strict();
async function scope(){try{return scopeSchema.parse(JSON.parse(await fs.readFile(/* turbopackIgnore: true */ process.env.APOLLO_CONTACT_SCOPE_PATH||'.runtime/no-apollo-contact-scope','utf8')));}catch{return null;}}
export function apolloCandidateBody(website:string){return {q_organization_domains_list:[new URL(website).hostname.replace(/^www\./,'')],page:1,per_page:5};}
export function apolloCandidatePeople(raw:any,company:any,now=new Date().toISOString()){
  if(!Array.isArray(raw.people)||raw.people.length>5)throw Error('APOLLO_PEOPLE_RESPONSE_INVALID');
  return raw.people.filter((p:any)=>p.id&&p.first_name).map((p:any)=>({id:p.id,providerId:p.id,name:[p.first_name,p.last_name||p.last_name_obfuscated].filter(Boolean).join(' '),
    title:p.title||'',nameMasked:!p.last_name,organization:p.organization,employerVerified:false,purchaseAuthority:'unknown',
    evidence:[{sourceUrl:'https://api.apollo.io/api/v1/mixed_people/api_search',quote:JSON.stringify(p),retrievedAt:now}],
    notice:'Apollo公司域名过滤候选；可能含曾任职关系，姓氏未揭露时不是完整姓名，邮箱电话未查询。'}));
}
function status(row:any,s:any){const selection=enterpriseSelectionView(row),requests=row.data.apolloContactResearch?.requests||[];
  const own=requests.filter((r:any)=>r.scopeId===s?.sharedBudget.id),denied=own.some((r:any)=>[401,403].includes(r.httpStatus));
  return {enabled:!!s&&s.tenantId===row.tenant_id&&s.campaignId===row.id&&s.selectionId===selection.confirmation?.id&&selection.confirmation.valid&&
    selection.selected.every((id:string)=>s.companyIds.includes(id))&&Date.now()+60000<Date.parse(s.expiresAt)&&!!process.env.APOLLO_API_KEY&&!denied,
    requests:own.length,reservedCredits:own.reduce((n:number,r:any)=>n+(r.reservedCredits||0),0),denied,
    unknown:own.some((r:any)=>['pending','unknown'].includes(r.status)),send:0};}
export async function apolloContactStatus(request:Request,tenantId:string,id:string){const s=await scope();return withTenant(request,tenantId,async tx=>status(await campaign(tx,id),s));}
export async function runApolloContacts(request:Request,tenantId:string,id:string){
 const s=await scope(),token=randomUUID();
 const {row,company,priorState}=await withTenant(request,tenantId,async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':apollo-contacts:'+id}))`;const row=await campaign(tx,id);
  if(!s||!status(row,s).enabled)throw new AccessError('APOLLO_CONTACT_SCOPE_REQUIRED',403);
  if(row.state==='running'||row.data.operatorLease||row.data.contactLease||row.data.contactBatchLease||row.data.apolloContactLease)throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
  const stage=row.data.apolloContactResearch||={requests:[]};if(stage.requests.some((r:any)=>['pending','unknown'].includes(r.status)))throw new AccessError('APOLLO_UNKNOWN_NO_REPLAY',409);
  const own=stage.requests.filter((r:any)=>r.scopeId===s.sharedBudget.id);if(own.length>=s.maxRequests)throw new AccessError('APOLLO_CONTACT_LIMIT',409);
  const company=row.data.companies.find((c:any)=>s.companyIds.includes(c.id)&&!stage.requests.some((r:any)=>r.companyId===c.id));
  if(!company?.website)throw new AccessError('APOLLO_CONTACT_NO_PENDING_COMPANY',409);const priorState=row.state;
  row.data.apolloContactLease={token};const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state='running',version=version+1 WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version}`;
  if(n!==1)throw new AccessError('SEARCH_VERSION_CONFLICT',409);row.version++;return {row,company,priorState};
 },true);
 const stage=row.data.apolloContactResearch,checkpoint=async()=>withTenant(request,tenantId,async tx=>{
  const held=!!row.data.apolloContactLease,n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state=${held?'running':priorState},version=version+1 WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version} AND data->'apolloContactLease'->>'token'=${token}`;
  if(n!==1)throw new AccessError('APOLLO_CONTACT_LEASE_LOST',409);row.version++;
 },true);
 try{
  const ledger={requests:stage.requests,project:{maxRequests:stage.requests.length+1,maxSpendUsd:0,maxApolloCredits:s!.maxCredits}};
  const save=async()=>{for(const r of stage.requests)if(!r.companyId){r.companyId=company.id;r.scopeId=s!.sharedBudget.id;}await checkpoint();};
  const call=transport(ledger,{keys:{APOLLO_API_KEY:process.env.APOLLO_API_KEY},live:true,costUpperBound:{apollo:0},cacheSeconds:{apollo:86400},beforeSend:sharedBudgetGuard(request,tenantId,s,row.data.project.analysis?.id)},save);
  const raw=await call('apollo','/api/v1/mixed_people/api_search',apolloCandidateBody(company.website)),people=apolloCandidatePeople(raw,company);
  company.contactCandidates={people,expiresAt:new Date(Date.now()+86400000).toISOString(),provider:'apollo',nameMasked:true};call.commit();stage.state='partial';await save();
  return {people:people.length,send:0};
 }catch(e){stage.state=stage.requests.some((r:any)=>['pending','unknown'].includes(r.status))?'unknown':'blocked';stage.error=(e as Error).message;throw e;}
 finally{delete row.data.apolloContactLease;await checkpoint();}
}
