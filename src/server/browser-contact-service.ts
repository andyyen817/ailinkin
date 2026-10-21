import 'server-only';
import fs from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import type {Campaign} from '@/domain/research';
import {browserContactInput,browserContactScope} from '@/domain/browser-contact';
import {withTenant} from './tenant';
import {campaign} from './research-store';
import {enterpriseSelectionView} from './enterprise-selection';
import {contactReviewTable} from './contact-review-table';
import {AccessError} from './policy';
import {putContactImage} from './contact-evidence-store';
import {openBrowserSession,existingBrowserSession,closeBrowserSession,browserSessionView,browserState} from '../../scripts/research/browser-contact-session.mjs';
import {searchVisibleContacts,collectVisibleContact} from '../../scripts/research/browser-contact-driver.mjs';
import {checkBrowserScope} from '../../scripts/research/browser-contact-policy.mjs';
import {runPublicContactBatch} from '../../scripts/research/public-contact-plan.mjs';
import {runPersonDiscovery} from '../../scripts/research/public-person-discovery.mjs';
import {savedDiscoverySources} from '../../scripts/research/public-discovery-sources.mjs';
import {analyzeBrowserCollection} from './browser-contact-model';
import {companyContactEntries} from './company-contact-entries';
import {extractPublicPerson} from './person-public-extraction';
export function combinedBrowserHistory(rows:Campaign[],row:Campaign){
  return {...row,data:{...row.data,browserContactJobs:rows.flatMap(r=>r.data.browserContactJobs||[]),contactResearchRuns:rows.flatMap(r=>r.data.contactResearchRuns||[])}};
}
export async function browserHistory(tx:any,row:Campaign,scope:any){
  const rows=[row];if(scope?.tenantId===row.tenant_id&&(scope.campaignIds||[scope.campaignId]).includes(row.id))for(const id of scope.campaignIds||[]){
    if(id===row.id)continue;const other=await campaign(tx,id);
    if(other.tenant_id!==row.tenant_id||other.data.project.tenantId!==row.tenant_id)throw new AccessError('SEARCH_NOT_FOUND',404);rows.push(other);
  }
  return {rows,shared:combinedBrowserHistory(rows,row)};
}
export async function readBrowserScope(){try{return browserContactScope.parse(JSON.parse(await fs.readFile(/* turbopackIgnore: true */ process.env.SOCIAL_BROWSER_SCOPE_PATH||'.runtime/no-social-browser-scope','utf8')));}catch{return null;}}
export function authorizeBrowserJob(row:Campaign,tenantId:string,operatorId:string,raw:unknown,scope:any){
  const input=browserContactInput.parse(raw),view=enterpriseSelectionView(row);
  if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId||row.id!==input.campaignId)throw new AccessError('SEARCH_NOT_FOUND',404);
  const selected=view.rows.filter((r:any)=>view.selected.includes(r.id)).map((r:any)=>r.companyId);
  if(!view.confirmation?.valid||!selected.includes(input.companyId))throw new AccessError('ENTERPRISE_SELECTION_STALE',409);
  if(input.action!=='close')try{checkBrowserScope(scope,{tenantId,operatorId,campaignId:row.id,companyId:input.companyId,platform:input.platform});}catch{throw new AccessError('BROWSER_SCOPE_REQUIRED',409);}
  if(['public_batch','public_direct','public_discovery'].includes(input.action)&&scope?.mode!=='anonymous_public')throw new AccessError('ANONYMOUS_SCOPE_REQUIRED',409);
  if(input.action==='public_discovery'&&!scope?.discoverySourceUrls?.length)throw new AccessError('PERSON_DISCOVERY_SCOPE_REQUIRED',409);
  if(input.action==='public_discovery'&&input.personName&&!scope?.discoveryPersonNames?.includes(input.personName))throw new AccessError('PERSON_DISCOVERY_NAME_OUTSIDE_SCOPE',409);
  const company=row.data.companies.find((c:any)=>c.id===input.companyId);if(!company)throw new AccessError('SEARCH_NOT_FOUND',404);
  if(input.personName&&!contactReviewTable(row).rows.some(p=>p.companyId===company.id&&p.kind==='person'&&p.name===input.personName&&p.evidence.length))throw new AccessError('PERSON_SOURCE_REQUIRED',409);
  return {input,company};
}
export function browserJobsView(row:Campaign,operatorId:string,scope:any){
  const records=(row.data.browserContactJobs||[]).filter((j:any)=>j.operatorId===operatorId&&j.scopeId===scope?.id);
  const usage=Object.fromEntries(['networkRequests','pageReads','screenshots','searchQueries'].map(k=>[k,Math.max(0,...records.map((j:any)=>Number(j.browser?.usage?.[k]||0)))]));
  const budget={usage,exhausted:!!scope&&(usage.networkRequests>=scope.maxNetworkRequests||usage.pageReads>=scope.maxPageReads),overrun:!!scope&&usage.networkRequests>scope.maxNetworkRequests};
  return {jobs:(row.data.browserContactJobs||[]).filter((j:any)=>j.operatorId===operatorId).sort((a:any,b:any)=>(Date.parse(a.createdAt)||0)-(Date.parse(b.createdAt)||0)).slice(-30),enabled:!!scope&&scope.operatorId===operatorId&&scope.tenantId===row.tenant_id&&(scope.campaignIds||[scope.campaignId]).includes(row.id)&&Date.parse(scope.expiresAt)>Date.now(),
    scope:scope?{mode:scope.mode,engines:scope.engines,maxSearchQueries:scope.maxSearchQueries,maxPageReads:scope.maxPageReads,maxNetworkRequests:scope.maxNetworkRequests,maxScreenshots:scope.maxScreenshots,maxModelRequests:scope.maxModelRequests,maxSpendUsd:scope.maxSpendUsd,expiresAt:scope.expiresAt,personDiscovery:!!scope.discoverySourceUrls?.length}:null,
    discoverySources:row.data.companies.flatMap((c:any)=>savedDiscoverySources(row.data.browserContactJobs||[],c,scope?.platforms||[])),budget,sent:0};
}
export async function runBrowserContact(request:Request,tenantId:string,raw:unknown){
  const scope=await readBrowserScope(),input=browserContactInput.parse(raw),token=randomUUID();
  const {row,company,job,operatorId,priorState,history}=await withTenant(request,tenantId,async(tx,ctx)=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':browser-contact:'+(scope?.id||input.campaignId)}))`;
    const row=await campaign(tx,input.campaignId),{company}=authorizeBrowserJob(row,tenantId,ctx.userId,input,scope);
    const history=await browserHistory(tx,row,scope);
    if(history.rows.some(r=>r.id!==row.id&&(r.state==='running'||r.data.operatorLease||r.data.browserContactLease)))throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
    if(row.state==='running'||row.data.operatorLease||row.data.contactBatchLease||row.data.contactLease||row.data.browserContactLease)throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
    const jobs=row.data.browserContactJobs||=[];
    let job=input.action==='analyze'?jobs.find((j:any)=>j.id===input.collectionId&&j.operatorId===ctx.userId&&j.companyId===company.id&&j.platform===input.platform):null;
    if(input.action==='analyze'&&!job)throw new AccessError('BROWSER_COLLECTION_REQUIRED',409);
    if(input.action==='analyze'&&(job.analysisAttempted||job.scopeId!==scope?.id))throw new AccessError('BROWSER_MODEL_ALREADY_ATTEMPTED',409);
    if(!job){if(jobs.length>=200)throw new AccessError('BROWSER_HISTORY_LIMIT',409);
      job={id:'BC-'+createHash('sha256').update(token).digest('hex').slice(0,24),scopeId:scope?.id||'BROWSER-CLOSE',operatorId:ctx.userId,companyId:company.id,companyName:company.name,platform:input.platform,
        action:input.action,state:'running',fresh:false,createdAt:new Date().toISOString(),sent:0};jobs.push(job);}
    const priorState=row.state;row.data.browserContactLease={token,jobId:job.id,priorState,until:new Date(Date.now()+180000).toISOString()};
    const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state='running',lease_token=${token},lease_until=now()+interval '3 minutes',version=version+1,updated_at=now() WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version}`;
    if(n!==1)throw new AccessError('SEARCH_VERSION_CONFLICT',409);row.version++;return {row,company,job,operatorId:ctx.userId,priorState,history};
  },true);
  const checkpoint=async()=>withTenant(request,tenantId,async tx=>{
    const current=await campaign(tx,row.id);if(current.data.browserContactLease?.token!==token)throw new AccessError('BROWSER_LEASE_LOST',409);
    const held=!!row.data.browserContactLease;
    const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state=${held?'running':priorState},lease_token=${held?token:null},lease_until=${held?new Date(Date.now()+180000):null},version=version+1,updated_at=now() WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version}`;
    if(n!==1)throw new AccessError('SEARCH_VERSION_CONFLICT',409);row.version++;
  },true);
  try{
    if(input.action==='close'){try{job.browser=browserSessionView(existingBrowserSession(tenantId,operatorId));}catch{}await closeBrowserSession(tenantId,operatorId);job.state='closed';}
    else if(input.action==='analyze')await analyzeBrowserCollection(row,job,scope!,checkpoint,history.shared.data);
    else{
      const previous=(history.shared.data.browserContactJobs||[]).filter((j:any)=>j.scopeId===scope!.id&&j.id!==job.id&&j.operatorId===operatorId);
      const initialUsage=Object.fromEntries(['networkRequests','blockedRequests','pageReads','screenshots','searchQueries'].map(k=>[k,Math.max(0,...previous.map((j:any)=>Number(j.browser?.usage?.[k]||0)))]));
      const session=['open','public_batch','public_direct','public_discovery'].includes(input.action)?await openBrowserSession(scope!,input.platform,{initialUsage}):existingBrowserSession(tenantId,operatorId);
      if(session.platform!==input.platform)throw Error('BROWSER_PLATFORM_MISMATCH');
      if(input.action==='open'){job.state=await browserState(session);job.browser=browserSessionView(session);}
      else{
        const allAccounts=[...(row.data.contactResearchPlans||[]).flatMap((p:any)=>p.companies||[]).filter((c:any)=>c.companyId===company.id).flatMap((c:any)=>c.accounts||[]),
          ...companyContactEntries(row.data,company).map(c=>({...c,url:c.value,ownership:'official_link'}))];
        const accounts=allAccounts.filter((a:any)=>a.platform===input.platform);
        if(input.action==='public_direct'&&!accounts.some((a:any)=>a.evidence?.length))throw new AccessError('KNOWN_PUBLIC_ACCOUNT_REQUIRED',409);
        const allHistory=(history.shared.data.browserContactJobs||[]).filter((j:any)=>j.id!==job.id);
        const result=input.action==='public_discovery'?await runPersonDiscovery(session,company,{personName:input.personName,history:allHistory,checkpoint:async(value:any)=>{const {images,...partial}=value;job.page=partial;job.browser=browserSessionView(session);await checkpoint();}}):
          ['public_batch','public_direct'].includes(input.action)?await runPublicContactBatch(session,company,{personName:input.personName,preferredPlatform:input.platform,directOnly:input.action==='public_direct',accounts:allAccounts,history:allHistory,
          checkpoint:async(value:any)=>{const {images,...partial}=value;job.page=partial;job.browser=browserSessionView(session);await checkpoint();}}):
          input.action==='search_collect'?await searchVisibleContacts(session,company,{personName:input.personName,accounts}):await collectVisibleContact(session,company,{personName:input.personName});
        if(['public_batch','public_direct','public_discovery'].includes(input.action))session.platform=input.platform;
        const {images=[],...page}:any=result;job.state=result.state;job.fresh=!!result.fresh;job.page=page;job.browser=browserSessionView(session);job.images=[];
        for(const image of images){const {bytes,...meta}=image;job.images.push({...meta,...await putContactImage(tenantId,bytes)});}
        if(result.fresh&&'url' in result){const run={id:'CE-'+job.id.slice(3),scopeId:scope!.id,companyId:company.id,companyName:company.name,platform:input.platform,url:result.url,
          pageKey:job.id,state:'done',createdAt:job.createdAt,finishedAt:new Date().toISOString(),requests:[],page:job.page,images:job.images,people:[],channels:page.channels||[],
          unknowns:['新社媒正文已保存；人物及截图尚未交模型整理。'],sourcePlatforms:page.pages?.filter((p:any)=>p.fresh).map((p:any)=>p.platform)||[input.platform],sent:0};
          if(input.personName){const prior=(row.data.contactResearchRuns||[]).flatMap((r:any)=>r.people||[]).find((p:any)=>p.name===input.personName);
            const person={name:input.personName,companyName:company.name,sourcePersonId:prior?.sourcePersonId||input.personName.normalize('NFKC').toLowerCase()};
            const extracted=extractPublicPerson(person,{...page,relevant:true,sourceType:'social_body',readAt:page.retrievedAt});
            Object.assign(run,{people:extracted.people,channels:[...run.channels,...extracted.channels]});job.people=extracted.people.length;
          }
          (row.data.contactResearchRuns||=[]).push(run);job.runId=run.id;}
      }
    }
    job.finishedAt=new Date().toISOString();await checkpoint();
  }catch(e){try{job.browser=browserSessionView(existingBrowserSession(tenantId,operatorId));}catch{}job.state='blocked';job.reason=e instanceof Error?e.message.split('\n')[0]:'BROWSER_CONTACT_FAILED';job.finishedAt=new Date().toISOString();await checkpoint().catch(()=>{});}
  finally{delete row.data.browserContactLease;await checkpoint().catch(()=>{});}
  return {...browserJobsView(combinedBrowserHistory(history.rows,row),operatorId,scope),job,sent:0};
}
