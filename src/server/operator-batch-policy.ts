import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {companyDomain} from './contact-provider-finders';
import {savedUnqueriedPeople,operatorReservedCredits,savedOperatorDaily} from './operator-saved-people';
import {assertSelfServiceGrant} from './operator-selfservice-policy';
import {executableEnrichmentLimits} from './contact-enrichment-policy';
export const operatorKey=(...parts:unknown[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export const batchLabels:Record<string,string>={checking:'核对免费余额',confirm:'等待确认免费限额',running:'自动采集中',paused:'已暂停',exporting:'生成总表中',done:'已保存并生成总表',blocked:'需要处理后继续'};
export function assertOperatorScope(scope:any,tenantId:string,actorId:string,now=Date.now()){
  if(!scope?.enabled||scope.tenantId!==tenantId||scope.actorId!==actorId||scope.cash!==0||scope.send!==false||scope.purchase!==false||scope.phoneReveal!==false||scope.register!==false||!Number.isFinite(Date.parse(scope.notAfter))||Date.parse(scope.notAfter)<=now)throw Error('OPERATOR_SCOPE_EXPIRED_OR_DENIED');
  if(scope.selfService){assertSelfServiceGrant(scope);return;}
  if(!scope.approvalEvidence||!scope.anchorCampaignId||!scope.targets?.length||scope.targets.length>3||scope.discoverTargets?.length>2)throw Error('OPERATOR_APPROVED_SCOPE_REQUIRED');
  const saved=scope.mode==='saved_unqueried',caps=saved?{pages:0,finder:73,verify:1,accounts:4}:{pages:2,finder:4,verify:2,accounts:4};
  if(saved&&(!Array.isArray(scope.savedPersonKeys)||!scope.savedPersonKeys.length||scope.savedPersonKeys.length>73||new Set(scope.savedPersonKeys).size!==scope.savedPersonKeys.length||!(scope.credits?.prospeo>0&&scope.credits.prospeo<=34)||!(scope.credits?.hunter>=0&&scope.credits.hunter<=0.5)||scope.creditPolicyEvidence!=='https://prospeo.io/api-docs/enrich-person'))throw Error('OPERATOR_SAVED_GRANT_REQUIRED');
  for(const [key,cap] of Object.entries(caps))if(!Number.isInteger(scope.limits?.[key])||scope.limits[key]<0||scope.limits[key]>cap)throw Error('OPERATOR_LIMIT_INVALID');
}
export function operatorUsage(batches:any[],scopeId?:string){
  const receipts=batches.filter(b=>!scopeId||b.scopeId===scopeId).flatMap(b=>b.receipts||[]);
  const count=(kind:string)=>receipts.filter(r=>r.kind===kind&&r.state!=='skipped'&&!r.reusedFrom).length;
  return {pages:count('page'),finder:count('finder'),verify:count('verify'),accounts:count('account'),failures:receipts.filter(r=>['failed','unknown'].includes(r.state)).length,
    searches:count('public_search'),publicPages:count('public_page')+count('public_qualification'),network:receipts.flatMap(r=>r.stages||[]).filter(s=>s.stage==='public_network_started').length,pdfs:receipts.flatMap(r=>r.stages||[]).filter(s=>s.stage==='public_pdf_saved').length,
    ...(batches.some(b=>b.selfService)?{companies:count('company_search'),locations:count('location')}:{} )};
}
export function nextOperatorPage(rows:any[],companyId:string){
  const old=rows.flatMap(r=>(r.data.companyPathRuns||[]).flatMap((v:any)=>v.calls||[])).filter(c=>c.companyId===companyId&&c.action==='prospeo_people');
  const recent=rows.flatMap(r=>(r.data.operatorBatches||[]).flatMap((b:any)=>b.receipts||[])).filter(c=>c.companyId===companyId&&c.kind==='page');
  const history=[...old,...recent];
  if(history.some(c=>['reserved','unknown','failed'].includes(c.state)))throw Error('OPERATOR_PREVIOUS_PAGE_RESULT_UNKNOWN');
  return Math.max(0,...history.filter(c=>['received','done'].includes(c.state)).map(c=>c.page||1))+1;
}
export function makeOperatorBatch(scope:any,rows:any[],input:any,actorId:string,now=new Date().toISOString()){
  assertOperatorScope(scope,scope.tenantId,actorId,Date.parse(now));
  if(!Array.isArray(input.companyIds)||!input.companyIds.length||new Set(input.companyIds).size!==input.companyIds.length)throw Error('OPERATOR_COMPANIES_REQUIRED');
  const all=rows.flatMap(r=>r.data.operatorBatches||[]),active=all.find(b=>b.scopeId===scope.id&&!['done','blocked'].includes(b.state));
  if(active)return {batch:active,reused:true};
  const used=operatorUsage(all,scope.id),targets=input.companyIds.map((id:string)=>{
    const t=(scope.mode==='saved_unqueried'?scope.targets:scope.discoverTargets).find((t:any)=>t.companyId===id),row=rows.find(r=>r.id===t?.campaignId),company=row?.data.companies.find((c:any)=>c.id===id);
    if(!t||!row||row.tenant_id!==scope.tenantId||row.data.project.tenantId!==scope.tenantId||!company||companyDomain(company.website)!==t.domain||company.qualification?.status!=='qualified')throw Error('OPERATOR_COMPANY_DENIED');
    return {...t,name:company.name,...(scope.mode==='saved_unqueried'?{}:{page:nextOperatorPage(rows,id)})};
  });
  const limits:any={pages:scope.mode==='saved_unqueried'?0:targets.length,accounts:4};
  for(const k of ['finder','verify']){const value=input[k];if(!Number.isInteger(value)||value<0||value>scope.limits[k]-used[k as 'finder'|'verify'])throw Error('OPERATOR_LIMIT_INVALID');limits[k]=value;}
  if(limits.pages>scope.limits.pages-used.pages||used.accounts+4>scope.limits.accounts)throw Error('OPERATOR_GRANT_EXHAUSTED');
  const people=scope.mode==='saved_unqueried'?savedUnqueriedPeople(rows,scope).filter(p=>input.companyIds.includes(p.companyId)):[];
  if(scope.mode==='saved_unqueried'&&!people.length)throw Error('OPERATOR_NO_UNQUERIED_PEOPLE');
  return {reused:false,batch:{id:randomUUID(),scopeId:scope.id,mode:scope.mode,creditLimits:scope.credits,dailyLimit:scope.mode==='saved_unqueried'?savedOperatorDaily(rows,Date.parse(now)):null,actorId,state:'checking',createdAt:now,targets,limits,receipts:[],people,events:[{at:now,message:'批次已保存，准备核对现有免费余额。'}],failures:0,sent:0,cash:0}};
}
export function executableOperatorLimits(batch:any){
  if(batch.mode==='people_enrichment')return executableEnrichmentLimits(batch);
  const a=batch.accounts;
  if(!['prospeo','hunter'].every(p=>/^free$/i.test(a?.[p]?.plan||'')&&Number.isFinite(a[p].remaining)&&a[p].remaining>=0))throw Error('OPERATOR_FREE_BALANCE_REQUIRED');
  if(batch.selfService){
    const remaining=Math.min(a.prospeo.remaining,batch.creditLimits.prospeo);
    const pages=Math.min(batch.limits.pages,Math.max(0,Math.floor(remaining)-2));
    return {...batch.limits,pages,finder:Math.min(batch.limits.finder,Math.max(0,Math.floor(remaining)-2-pages),batch.dailyLimit?.remaining??Infinity),
      verify:Math.min(batch.limits.verify,Math.floor(Math.min(a.hunter.remaining,batch.creditLimits.hunter)*2))};
  }
  const pages=batch.mode==='saved_unqueried'?0:Math.min(batch.targets.length,Math.floor(a.prospeo.remaining));
  return {pages,finder:batch.mode==='saved_unqueried'?(a.prospeo.remaining>=1?Math.min(batch.limits.finder,batch.people.length,batch.dailyLimit?.remaining??Infinity):0):Math.min(batch.limits.finder,Math.max(0,Math.floor(a.prospeo.remaining)-pages)),verify:Math.min(batch.limits.verify,Math.floor(a.hunter.remaining*2)),accounts:4};
}
export function changeOperatorBatch(batch:any,action:string,now=new Date().toISOString()){
  if(action==='confirm'){
    if(['running','exporting','done'].includes(batch.state))return false;
    if(batch.state!=='confirm')throw Error('OPERATOR_NOT_READY');
    batch.limits=executableOperatorLimits(batch);batch.confirmedAt=now;batch.state='running';batch.stage=batch.mode==='people_enrichment'?'enrichment':batch.selfService?'companies':'pages';
    batch.sourceExpiresAt=new Date(Math.min(Date.parse(now)+3600000,Date.parse(batch.localExpiresAt))).toISOString();
  }else if(action==='refresh_export'){
    if(batch.state==='exporting')return false;
    if(batch.state!=='done'||batch.lease)throw Error('OPERATOR_NOT_READY');
    (batch.exportHistory||=[]).push(structuredClone(batch.export));batch.state='exporting';
  }else if(action==='pause'){
    if(['paused','done','blocked'].includes(batch.state))return false;
    batch.pauseRequested=true;
    if(!batch.lease){batch.resumeState=batch.state;batch.state='paused';}
  }else if(action==='resume'){
    if(batch.state!=='paused')return false;
    if(Date.parse(batch.sourceExpiresAt||batch.localExpiresAt)<=Date.parse(now))throw Error('OPERATOR_WINDOW_EXPIRED');
    batch.pauseRequested=false;batch.state=batch.resumeState||'running';
  }else throw Error('OPERATOR_ACTION_INVALID');
  batch.events.push({at:now,message:{confirm:'已确认免费限额，自动执行。',pause:'已申请暂停，当前请求回执保存后停止。',resume:'从已保存进度继续，不重复提交原请求。',refresh_export:'仅使用已保存资料更新总表，不新增来源查询。'}[action]});return true;
}
export function publicOperatorBatch(batch:any){
  return {id:batch.id,scopeId:batch.scopeId,selfService:!!batch.selfService,mode:batch.mode,traceMethod:batch.traceMethod,sourceBatchId:batch.sourceBatchId,publicQualification:batch.publicQualification,direction:batch.direction,companyChoices:batch.companyChoices,location:batch.location,state:batch.state,status:batch.state==='selecting'?'请选择要查联系人的企业':batchLabels[batch.state]||batch.state,stage:batch.stage,createdAt:batch.createdAt,confirmedAt:batch.confirmedAt,sourceExpiresAt:batch.sourceExpiresAt,limits:batch.limits,creditLimits:batch.creditLimits,dailyLimit:batch.dailyLimit,currentDailyRemaining:batch.currentDailyRemaining,creditsReserved:{prospeo:operatorReservedCredits(batch.receipts,'prospeo'),hunter:operatorReservedCredits(batch.receipts,'hunter')},accounts:batch.accounts,finalAccounts:batch.finalAccounts,usage:operatorUsage([batch]),people:batch.people,events:batch.events.slice(-12),reason:batch.reason||batch.publicSearchQuality?.reason,exportReady:batch.state==='done'&&!!batch.export,failures:batch.failures||0,pauseRequested:!!batch.pauseRequested};
}
