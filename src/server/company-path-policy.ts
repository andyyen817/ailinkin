import 'server-only';
import {createHash} from 'node:crypto';
import {companyDomain} from './contact-provider-finders';
import type {CompanyPathAction} from './company-path-providers';
import {enterpriseSelectionView} from './enterprise-selection';
export const pathKey=(action:string,domain:string,page=1)=>createHash('sha256').update(JSON.stringify(page===1?[action,domain]:[action,domain,page])).digest('hex');
export function companyPathPage(scope:any,companyId:string,action:string){
  if(scope.batchType!=='new_contact_pages')return 1;
  if(!scope.approvalEvidence||action!=='prospeo_people'||scope.actions?.join(',')!=='prospeo_people'||scope.companyIds?.length!==2||scope.pages?.[companyId]!==2)throw Error('COMPANY_PATH_UNREAD_PAGE_SCOPE_REQUIRED');
  return 2;
}
export function onlyNewCompanyPeople(rows:any[],companyId:string,result:any){
  const normal=(v:any)=>String(v||'').normalize('NFKC').trim().toLowerCase(),url=(v:any)=>normal(v).replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'');
  const old=rows.flatMap(r=>[...(r.data.contactResearchRuns||[]).filter((v:any)=>v.companyId===companyId).flatMap((v:any)=>v.people||[]),...(r.data.contacts||[]).filter((v:any)=>v.companyId===companyId)]);
  const ids=new Set(old.map((p:any)=>p.sourcePersonId).filter(Boolean)),links=new Set(old.map((p:any)=>url(p.profileUrl)).filter(Boolean)),names=new Set(old.map((p:any)=>normal(p.name)).filter(Boolean));
  const held=[...(result.held||[])],people=[];
  for(const p of result.people||[]){if(ids.has(p.sourcePersonId)||links.has(url(p.profileUrl))||names.has(normal(p.name)))held.push({reason:'previously_saved_identity',sourcePersonId:p.sourcePersonId,name:p.name,profileUrl:p.profileUrl});else{people.push(p);ids.add(p.sourcePersonId);if(p.profileUrl)links.add(url(p.profileUrl));names.add(normal(p.name));}}
  return {...result,people,held,duplicateCount:held.filter(p=>p.reason==='previously_saved_identity').length};
}
export function authorizeCompanyPaths(row:any,tenantId:string,actorId:string,scope:any,companyId?:string,now=Date.now()){
  if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw Error('COMPANY_PATH_TENANT_DENIED');
  if(!scope?.enabled||scope.purpose!=='internal_test'||scope.tenantId!==tenantId||scope.actorId!==actorId||!scope.campaignIds?.includes(row.id)||!Number.isFinite(Date.parse(scope.notAfter))||Date.parse(scope.notAfter)<=now||scope.send!==false||scope.purchase!==false||scope.phoneReveal!==false)throw Error('COMPANY_PATH_SCOPE_REQUIRED');
  if(companyId){const c=row.data.companies.find((c:any)=>c.id===companyId),view=enterpriseSelectionView(row);
    if(!c||!scope.companyIds?.includes(companyId)||!view.confirmation?.valid||!view.rows.some((r:any)=>r.companyId===companyId&&view.selected.includes(r.id)))throw Error('COMPANY_PATH_SELECTION_REQUIRED');
    const d=companyDomain(c.website);if(!d||scope.domains?.[companyId]!==d)throw Error('COMPANY_PATH_DOMAIN_CHANGED');return c;
  }
}
export function pathJournal(rows:any[],scopeId:string){return rows.flatMap(r=>(r.data.companyPathRuns||[]).filter((v:any)=>v.scopeId===scopeId)).sort((a:any,b:any)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));}
export function pathBudget(runs:any[],scope:any){
  const calls=runs.flatMap(r=>r.calls||[]),used=(a:string)=>calls.filter((c:any)=>c.action===a).length;
  const renewal=scope.renewalEvidence&&Number.isFinite(Date.parse(scope.renewedAt))?Date.parse(scope.renewedAt):0;
  return {hunterCalls:used('hunter_domain'),companyCalls:used('prospeo_company'),peopleCalls:used('prospeo_people'),accountCalls:calls.filter((c:any)=>c.action.startsWith('account_')).length,
    hunterReserved:used('hunter_domain')*2,prospeoReserved:used('prospeo_company')+used('prospeo_people'),networkRequests:calls.length,
    expiresAt:runs[0]?new Date(Math.min(Math.max(Date.parse(runs[0].createdAt),renewal)+3600000,Date.parse(scope.notAfter))).toISOString():null};
}
export function reserveCompanyPath(runs:any[],scope:any,action:string,now=Date.now()){
  const b=pathBudget(runs,scope);if(b.expiresAt&&Date.parse(b.expiresAt)<=now)throw Error('COMPANY_PATH_BATCH_EXPIRED');
  if(runs.flatMap(r=>r.calls||[]).some((c:any)=>c.action===action&&(c.state==='unknown'||c.state==='failed'&&/PLAN_REQUIRED|INVALID_API_KEY|403|401|429|5\d\d/.test(c.reason||''))))throw Error('COMPANY_PATH_SOURCE_PAUSED');
  const max={hunter_domain:3,prospeo_company:3,prospeo_people:3,account_hunter:4,account_prospeo:4} as Record<string,number>;
  const count=runs.flatMap(r=>r.calls||[]).filter((c:any)=>c.action===action).length;
  if(scope.batchType==='new_contact_pages'&&!action.startsWith('account_')&&(action!=='prospeo_people'||count>=2||b.prospeoReserved>=2))throw Error('COMPANY_PATH_LIMIT_REACHED');
  if(!max[action]||count>=max[action]||action.startsWith('account_')&&b.accountCalls>=4||action==='hunter_domain'&&b.hunterReserved+2>6||action.startsWith('prospeo_')&&b.prospeoReserved+1>6)throw Error('COMPANY_PATH_LIMIT_REACHED');
  return b;
}
export function previousCompanyPath(rows:any[],action:CompanyPathAction,domain:string,now=Date.now(),page=1){
  const key=pathKey(action,domain,page),found=rows.flatMap(r=>r.data.companyPathRuns||[]).flatMap(r=>r.calls||[]).filter((c:any)=>c.key===key).at(-1);
  if(!found)return null;
  if(['unknown','reserved','failed'].includes(found.state))throw Error('COMPANY_PATH_PREVIOUS_RESULT_REQUIRES_RECONCILIATION');
  if(found.state==='received'&&(page>1||Date.parse(found.expiresAt)>now))return found;
  return null;
}
export function companyPathView(row:any,rows:any[],scope:any){
  const runs=scope?pathJournal(rows,scope.id):[],last=runs.at(-1);
  const companies=rows.flatMap(r=>r.data.companies);
  return {enabled:!!scope?.enabled&&Date.parse(scope.notAfter)>Date.now(),unreadPages:scope?.batchType==='new_contact_pages'?scope.pages:null,budget:scope?pathBudget(runs,scope):null,
    companies:row.data.companies.map((c:any)=>({id:c.id,name:c.name,domain:companyDomain(c.website)})),
    calls:runs.flatMap(r=>r.calls||[]).map((c:any)=>({action:c.action,companyId:c.companyId,companyName:companies.find(v=>v.id===c.companyId)?.name,state:c.state,people:c.people||0,companyChannels:c.channels||0,
      page:c.page||1,duplicates:c.result?.duplicateCount||0,personalChannels:(c.result?.people||[]).reduce((n:number,p:any)=>n+(p.contacts?.length||0),0),sourceTotal:c.raw?.pagination?.total_count,reason:c.reason})),notExecuted:runs.flatMap(r=>r.notExecuted||[]),accounts:Object.assign({},...runs.map(r=>r.accounts||{})),sent:0};
}
