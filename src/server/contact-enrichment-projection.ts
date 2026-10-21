import 'server-only';
import {extractEnrichmentEvidence,enrichmentCandidates} from './contact-enrichment-evidence';
import {traceOwnershipEvidence} from './contact-trace-identity';
export function applyEnrichmentPublic(batch:any,rows:any[],op:any){
  if(op.kind==='public_qualification'){batch.publicQualification=op.state==='done'?op.result:{free:false,reason:op.reason};return;}
  const p=batch.people.find((p:any)=>p.personKey===op.personKey);if(!p)return;
  if(op.kind==='public_search'){
    const candidates=op.state==='done'?enrichmentCandidates(p,op.result.results||[]):[];
    p.publicReason=op.state==='done'?`已搜索公开线索，取得${candidates.length}个可读候选；摘要不代表归属确认。`:`公开搜索未完成：${op.reason||'来源不可用'}。`;
    return;
  }
  if(op.kind!=='public_page')return;
  const check={url:op.url,state:op.result?.state||op.state,reason:op.result?.reason||op.reason||(op.result?.format==='pdf'?`PDF已读${op.result.pagesRead}／${op.result.totalPages}页；归属按所读页核实。`:'已读取正文；是否属于本人另行核实'),retrievedAt:op.finishedAt};
  p.publicChecks||=[];if(!p.publicChecks.some((c:any)=>c.url===check.url))p.publicChecks.push(check);
  if(op.state!=='done'||op.result?.state!=='read'){
    if(batch.traceMethod&&/429|LOGIN|ROBOTS_RESTRICTED/.test(op.result?.reason||'')){(batch.traceHeldOrigins||={})[new URL(op.result?.url||op.url).origin]=op.result.reason;}
    p.publicReason='网页未读取或访问受限：'+(op.result?.reason||op.reason||'未知');
    if(op.state==='done'){op.state='failed';op.reason=op.result?.reason||'PUBLIC_BODY_NOT_READ';batch.failures++;}return;
  }
  const found=batch.traceMethod==='trace_v2'?traceOwnershipEvidence(p,op.result,batch.people):extractEnrichmentEvidence(p,op.result);p.ownershipEvidence||=[];p.emailCandidates||=[];p.otherAccounts||=[];
  for(const item of found.emails)if(!p.emailCandidates.some((c:any)=>c.value===item.value&&c.evidence[0]?.sourceUrl===item.evidence[0]?.sourceUrl))p.emailCandidates.push(item);
  for(const item of found.accounts)if(!p.otherAccounts.some((a:any)=>a.value===item.value&&a.confirmed===item.confirmed))p.otherAccounts.push(item);
  p.ownershipEvidence.push(...found.evidence.filter((e:any)=>!p.ownershipEvidence.some((v:any)=>v.sourceUrl===e.sourceUrl&&v.contentHash===e.contentHash)));
  const previousEmail=p.email,preferred=p.emailCandidates.find((c:any)=>c.confirmed)||p.emailCandidates[0];if(preferred)p.email=preferred.value;
  if(batch.traceMethod==='trace_v2'){p.verificationHeld=!!p.seedEmails?.includes(p.email);if(previousEmail!==p.email)delete p.technical;}
  p.publicReason=found.evidence.length?'已保存人物关联正文及归属证据；未证明的账号仍列候选。':'网页正文未证明是该人物。';
  const row=rows.find(r=>r.id===p.campaignId);if(!row)return;
  const contacts=[...found.emails.map(c=>({kind:'email',value:c.value,scope:'person',ownership:c.confirmed?'public_named_evidence':'needs_review',verification:'unverified',evidence:c.evidence})),
    ...found.accounts.filter(a=>a.confirmed).map(a=>({kind:'social',value:a.value,scope:'person',ownership:'public_profile_link',verification:'ownership_needs_review',evidence:a.evidence}))];
  const run={id:'CPR-OP-'+op.id,scopeId:batch.scopeId,companyId:p.companyId,companyName:p.companyName,platform:'公开网页',state:'done',createdAt:op.finishedAt,
    people:[{name:p.name,title:p.title,profileUrl:p.profileUrl,sourcePersonId:p.sourcePersonId,contacts,evidence:found.evidence,employerVerified:false,relationship:'unknown'}],channels:[],page:{method:'company_source_pool'},sourceFailures:[],sent:0};
  const runs=row.data.contactResearchRuns||=[],i=runs.findIndex((r:any)=>r.id===run.id);if(i<0)runs.push(run);else runs[i]=run;
}
export function enrichmentFinderEvidence(batch:any,op:any){
  const p=batch.people.find((p:any)=>p.personKey===op.personKey);if(!p)return;
  p.emailReason=p.reason;p.emailCandidates||=[];
  for(const person of op.result?.people||[])for(const c of person.contacts||[])if(c.kind==='email'&&!p.emailCandidates.some((v:any)=>v.value===c.value))p.emailCandidates.push({value:c.value,confirmed:false,ownership:'供应商对应人员ID与主页，归属仍待公开证据复核',evidence:c.evidence});
  const owned=p.emailCandidates.find((c:any)=>c.confirmed);if(owned)p.email=owned.value;
}
