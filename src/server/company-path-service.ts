import 'server-only';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {withTenant} from './tenant';
import {campaign} from './research-store';
import {AccessError} from './policy';
import {companyDomain} from './contact-provider-finders';
import {authorizeCompanyPaths,pathJournal,pathBudget,reserveCompanyPath,previousCompanyPath,pathKey,companyPathView,companyPathPage,onlyNewCompanyPeople} from './company-path-policy';
import {companyPathActions,companyPathCall,companyPathAccount,normalizeCompanyPaths,type CompanyPathAction} from './company-path-providers';
export const companyPathInput=z.object({campaignId:z.uuid(),action:z.enum(['check_accounts','discover']),companyId:z.string().min(1).max(100).optional()}).strict();
export async function readCompanyPathScope(){try{return JSON.parse(await fs.readFile(/* turbopackIgnore: true */process.env.COMPANY_PATH_SCOPE_PATH||'.runtime/no-company-path-scope','utf8'));}catch{return null;}}
export async function companyPathRows(tx:any,row:any,scope:any){
  const rows=[row];if(scope?.tenantId===row.tenant_id&&scope.campaignIds.includes(row.id))for(const id of scope.campaignIds){if(id===row.id)continue;const r=await campaign(tx,id);if(r.tenant_id!==row.tenant_id)throw new AccessError('SEARCH_NOT_FOUND',404);rows.push(r);}return rows;
}
export function applyCompanyPathResult(row:any,receipt:any,company:any){
  const runs=row.data.contactResearchRuns||=[],id='CPR-'+receipt.id,previous=runs.find((r:any)=>r.id===id);
  const result=receipt.result;if(!result)return;
  const projected={id,scopeId:receipt.scopeId,companyId:company.id,companyName:company.name,platform:receipt.action==='hunter_domain'?'Hunter':'Prospeo',state:'done',createdAt:receipt.finishedAt,
    people:result.people,channels:result.channels,held:result.held,page:{method:'company_source_pool'},sourceFailures:[],sent:0};
  if(previous)Object.assign(previous,projected);else runs.push(projected);
  if(row.data.contactMailHandoff)row.data.contactMailHandoff.superseded=true;
}
export async function executeCompanyPath(row:any,rows:any[],run:any,company:any,action:CompanyPathAction,scope:any,save:()=>Promise<void>,call=companyPathCall){
  const domain=companyDomain(company.website),page=companyPathPage(scope,company.id,action),cached=previousCompanyPath(rows,action,domain,Date.now(),page);
  if(cached){if(page===1){cached.result=normalizeCompanyPaths(action,company,cached.raw,cached.finishedAt);cached.normalizationVersion=2;}(run.reused||=[]).push({action,page,companyId:company.id,receiptId:cached.id});applyCompanyPathResult(row,cached,company);await save();return;}
  const journal=pathJournal(rows,scope.id);reserveCompanyPath(journal,scope,action);
  const provider=action==='hunter_domain'?'hunter':'prospeo',accounts=journal.find((r:any)=>r.accounts?.[provider])?.accounts;
  const account=accounts?.[provider],budget=pathBudget(journal,scope),required=provider==='hunter'?2:1,reserved=provider==='hunter'?budget.hunterReserved:budget.prospeoReserved;
  if(!account||!/^free$/i.test(account.plan)||!Number.isFinite(account.remaining)||account.remaining-reserved<required)throw Error('COMPANY_PATH_FREE_QUOTA_REQUIRED');
  const key=process.env[provider==='hunter'?'HUNTER_API_KEY':'PROSPEO_API_KEY']||'';if(!key)throw Error('COMPANY_PATH_KEY_UNAVAILABLE');
  const receipt:any={id:randomUUID(),scopeId:scope.id,key:pathKey(action,domain,page),companyId:company.id,action,page,state:'reserved',stages:[],createdAt:new Date().toISOString()};run.calls.push(receipt);await save();
  try{const raw=await call(action,domain,key,async stage=>{receipt.stages.push(stage);await save();},fetch,page);receipt.raw=raw;receipt.state='received';receipt.finishedAt=new Date().toISOString();receipt.expiresAt=new Date(Date.now()+7*86400000).toISOString();
    if(page>1&&raw.pagination?.current_page!==page)throw Error('COMPANY_PATH_RESPONSE_PAGE_UNKNOWN');
    const result=normalizeCompanyPaths(action,company,raw,receipt.finishedAt);receipt.result=page>1?onlyNewCompanyPeople(rows,company.id,result):result;receipt.people=receipt.result.people.length;receipt.channels=receipt.result.channels.length;applyCompanyPathResult(row,receipt,company);await save();
  }catch(e){receipt.state=(e as any).known?'failed':'unknown';receipt.reason=(e as Error).message.replaceAll(key,'[redacted]');await save();}
}
export async function companyPaths(request:Request,tenantId:string,raw:any){
  const input=companyPathInput.parse(raw),scope=await readCompanyPathScope(),token=randomUUID();
  const {row,rows,company,priorState,run}=await withTenant(request,tenantId,async(tx,ctx)=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':company-paths'}))`;
    const row=await campaign(tx,input.campaignId);let company:any;
    try{company=authorizeCompanyPaths(row,tenantId,ctx.userId,scope,input.action==='discover'?input.companyId:undefined);}catch(e){throw new AccessError((e as Error).message,403);}
    if(input.action==='discover'&&!input.companyId)throw new AccessError('COMPANY_PATH_SELECTION_REQUIRED',400);
    const rows=await companyPathRows(tx,row,scope);if(rows.some((r:any)=>r.state==='running'||r.data.operatorLease||r.data.companyPathLease||r.data.browserContactLease||r.data.contactLease||r.data.contactBatchLease))throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
    const journal=pathJournal(rows,scope.id);if(journal.length>=40)throw new AccessError('COMPANY_PATH_HISTORY_LIMIT',409);
    const run={id:randomUUID(),scopeId:scope.id,createdAt:new Date().toISOString(),calls:[],accounts:{},sent:0};
    const priorState=row.state;(row.data.companyPathRuns||=[]).push(run);row.data.companyPathLease={token,until:new Date(Date.now()+180000).toISOString()};
    const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state='running',version=version+1,updated_at=now() WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version}`;
    if(n!==1)throw new AccessError('SEARCH_VERSION_CONFLICT',409);row.version++;return {row,rows,company,priorState,run};
  },true);
  const save=async()=>withTenant(request,tenantId,async tx=>{
    const current=await campaign(tx,row.id);if(current.data.companyPathLease?.token!==token)throw new AccessError('COMPANY_PATH_LEASE_LOST',409);
    const held=!!row.data.companyPathLease;
    const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state=${held?'running':priorState},version=version+1,updated_at=now() WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version}`;
    if(n!==1)throw new AccessError('SEARCH_VERSION_CONFLICT',409);row.version++;
  },true);
  try{
    if(input.action==='check_accounts')for(const provider of ['hunter','prospeo'] as const){
      reserveCompanyPath(pathJournal(rows,scope.id),scope,'account_'+provider);
      const receipt:any={action:'account_'+provider,state:'reserved',stages:[]};(run.calls as any[]).push(receipt);await save();
      try{const account=await companyPathAccount(provider,process.env[provider==='hunter'?'HUNTER_API_KEY':'PROSPEO_API_KEY']||'',async stage=>{receipt.stages.push(stage);await save();});
        (run.accounts as any)[provider]=account;receipt.state='received';await save();
      }catch(e){receipt.state=(e as any).known?'failed':'unknown';receipt.reason=(e as Error).message;await save();}
    }else for(const action of (scope.batchType==='new_contact_pages'?['prospeo_people'] as const:companyPathActions)){
      try{await executeCompanyPath(row,rows,run,company,action,scope,save);}catch(e){((run as any).notExecuted||=[]).push({action,reason:(e as Error).message});await save();}
    }
  }finally{delete row.data.companyPathLease;await save();}
  return companyPathView(row,rows,scope);
}
