import 'server-only';
import {companyPathAccount,companyPathCall,normalizeCompanyPaths} from './company-path-providers';
import {onlyNewCompanyPeople} from './company-path-policy';
import {applyCompanyPathResult} from './company-path-service';
import {finderRequest,normalizeFinder} from './contact-provider-finders';
import {hunterRequest,normalizeEmailCheck} from './person-email-provider';
import {contactReviewTable} from './contact-review-table';
import {operatorKey} from './operator-batch-policy';
import {operatorDiscoveryCall} from './operator-discovery-provider';
import {applyOperatorDiscovery,optionalRolePriority} from './operator-discovery-results';
import {executeEnrichmentPublic} from './contact-enrichment-sources';
import {applyEnrichmentPublic,enrichmentFinderEvidence} from './contact-enrichment-projection';
export async function executeOperatorOperation(op:any,batch:any,record:any,fetcher:typeof fetch=fetch){
  if(op.kind.startsWith('public_'))return executeEnrichmentPublic(op,batch,record,fetcher);
  const key=process.env[op.provider==='hunter'?'HUNTER_API_KEY':'PROSPEO_API_KEY']||'';
  if(!key)throw Object.assign(Error('FREE_PROVIDER_KEY_UNAVAILABLE'),{known:true});
  const safeRecord=async(stage:any)=>record(JSON.parse(JSON.stringify(stage).replaceAll(key,'[redacted]')));
  if(op.kind==='account')return companyPathAccount(op.provider,key,safeRecord,fetcher);
  if(['location','company_search'].includes(op.kind))return operatorDiscoveryCall(op,batch,key,safeRecord,fetcher);
  if(op.kind==='page')return companyPathCall('prospeo_people',op.domain,key,safeRecord,fetcher,op.page);
  if(op.kind==='finder'){
    const person=batch.people.find((p:any)=>p.personKey===op.personKey);if(!person)throw Error('OPERATOR_PERSON_MISSING');
    return normalizeFinder('prospeo',person,await finderRequest('prospeo',person,key,fetcher,safeRecord));
  }
  if(op.kind==='verify'){
    await safeRecord({stage:'send_started',route:'/v2/email-verifier'});
    const raw=await hunterRequest('/v2/email-verifier',{email:op.email},key,fetcher,safeRecord);
    return normalizeEmailCheck(op.email,raw);
  }
  throw Error('OPERATOR_SOURCE_ACTION_DENIED');
}
export function previousOperatorEmail(rows:any[],email:string){
  const key=email.toLowerCase();
  for(const row of rows){
    for(const p of contactReviewTable(row).rows)for(const c of p.personChannels||[])if(c.kind==='email'&&c.value.toLowerCase()===key){
      if(c.technical)return {technical:structuredClone(c.technical),known:true};
    }
    for(const b of row.data.personResearchBatches||[])for(const o of b.fieldObservations||[])if(o.result?.email?.toLowerCase()===key&&o.result.technical)return {technical:structuredClone(o.result.technical),known:true};
    for(const b of row.data.operatorBatches||[])for(const r of b.receipts||[])if(r.kind==='verify'&&r.email===key)return {technical:r.state==='done'?structuredClone(r.result):null,known:true};
  }
  return {technical:null,known:rows.some(row=>contactReviewTable(row).rows.some(p=>(p.personChannels||[]).some(c=>c.kind==='email'&&c.value.toLowerCase()===key)))};
}
function project(row:any,batch:any,op:any,result:any){
  const receipt={id:'OP-'+op.id,scopeId:batch.scopeId,action:'prospeo_people',result,finishedAt:op.finishedAt};
  const company=row.data.companies.find((c:any)=>c.id===op.companyId);applyCompanyPathResult(row,receipt,company);
}
export function applyOperatorOperation(batch:any,rows:any[],op:any){
  if(op.kind.startsWith('public_')){applyEnrichmentPublic(batch,rows,op);return;}
  if(['location','company_search'].includes(op.kind)){applyOperatorDiscovery(batch,rows,op);return;}
  const target=batch.targets.find((t:any)=>t.companyId===op.companyId),row=rows.find(r=>r.id===target?.campaignId);
  if(op.kind==='page'){
    if(op.state!=='done')return;
    if(op.result.pagination?.current_page!==op.page)throw Error('OPERATOR_RETURNED_PAGE_MISMATCH');
    const company=row.data.companies.find((c:any)=>c.id===op.companyId),result=onlyNewCompanyPeople(rows,company.id,normalizeCompanyPaths('prospeo_people',company,op.result,op.finishedAt));
    op.savedPeople=result.people.length;op.duplicates=result.duplicateCount||0;project(row,batch,op,result);
    for(const p of result.people)batch.people.push({personKey:operatorKey(company.id,p.sourcePersonId||p.profileUrl),companyId:company.id,companyName:company.name,campaignId:row.id,name:p.name,title:p.title,rolePriority:optionalRolePriority(p.title||'',batch.direction?.roles),profileUrl:p.profileUrl,domain:target.domain,sourcePersonId:p.sourcePersonId,prospeoId:p.sourcePersonId?.startsWith('prospeo:')?p.sourcePersonId.slice(8):undefined,status:'未查询',reason:'已采集人物主页，尚未查工作邮箱。'});
  }else if(op.kind==='finder'){
    const person=batch.people.find((p:any)=>p.personKey===op.personKey);
    if(op.state!=='done'){person.status=op.state==='skipped'?'未查询':'来源受限';person.reason=(op.state==='skipped'?'本次未提交请求：':'本来源未完成：')+op.reason+'；未重复请求。';if(batch.mode==='people_enrichment'){person.finderSkipped=op.state==='skipped';enrichmentFinderEvidence(batch,op);}return;}
    const result=op.result,email=result.people?.flatMap((p:any)=>p.contacts||[]).find((c:any)=>c.kind==='email'&&c.scope==='person');
    if(!email){person.status=result.state==='identity_ambiguous'?'归属待核':'未找到';person.reason=result.notice||'本来源未找到个人邮箱，继续下一位。';project(row,batch,op,result);if(batch.mode==='people_enrichment')enrichmentFinderEvidence(batch,op);return;}
    person.email=email.value;person.status='邮箱待验证';person.reason='已保存工作邮箱候选，等待技术验证；归属待核。';
    const previous=previousOperatorEmail(rows,email.value);
    if(previous.known){person.technical=previous.technical;person.verificationHeld=!previous.technical;person.reused=true;person.status=previous.technical?'已复用邮箱验证，归属待核':'邮箱待验证';person.reason='该邮箱已在历史资料出现；保留历史验证或未知状态，不重复消耗额度。';email.technical=previous.technical;}
    project(row,batch,op,result);
    if(batch.mode==='people_enrichment')enrichmentFinderEvidence(batch,op);
  }else if(op.kind==='verify'){
    for(const p of batch.people.filter((p:any)=>p.email===op.email)){
      if(op.state!=='done'){p.status='验证未完成';p.reason='验证来源受限：'+op.reason+'；未重发。';continue;}
      p.technical=op.result;p.status=op.result.status==='valid'?'技术有效，归属待核':op.result.status==='invalid'?'邮箱无效':'具体邮箱仍待核实';p.reason='已保存Hunter验证回执；人物归属和任职需另外核实。';
    }
    if(op.state==='done')for(const r of rows)for(const run of r.data.contactResearchRuns||[])if(run.id.startsWith('CPR-OP-'))for(const p of run.people||[])for(const c of p.contacts||[])if(c.kind==='email'&&c.value.toLowerCase()===op.email)c.technical=op.result;
  }
}
