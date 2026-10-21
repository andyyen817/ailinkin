import {personJournal} from './person-research-runner';
export function newContactBatchScope(s:any){
  if(s?.batchType!=='new_contact_free')return null;
  const people=s.people||[],routes=['prospeo:/enrich-person','hunter:/v2/email-verifier'];
  if(!s.approvalEvidence||!s.previousHistoryEvidence||s.minutes!==60||s.maxPeople!==20||!people.length||people.length>20||
    new Set(people.map((p:any)=>p.personId)).size!==people.length||!Array.isArray(s.excludedPersonIds)||!Array.isArray(s.knownEmails)||
    people.some((p:any)=>!/^PI-[a-f0-9]{32}$/.test(p.personId)||!p.campaignId||!p.companyId||s.excludedPersonIds.includes(p.personId))||
    new Set(people.map((p:any)=>p.companyId)).size>2||[...new Set(people.map((p:any)=>p.companyId))].some(id=>people.filter((p:any)=>p.companyId===id).length>10)||
    ['searches','pages','network','images','models','usd','apollo'].some(k=>s.limits?.[k]!==0)||
    !Number.isInteger(s.limits?.finder)||s.limits.finder<0||s.limits.finder>20||!Number.isInteger(s.limits?.verifications)||s.limits.verifications<0||s.limits.verifications>20||
    s.sources?.length!==2||new Set(s.sources.map((v:any)=>v.provider+':'+v.endpoint)).size!==2||s.sources.some((v:any)=>!routes.includes(v.provider+':'+v.endpoint)||v.maxCostUsd!==0||v.fields?.join(',')!=='work_email'||v.modelTransfer!==false))return null;
  return s;
}
export async function prepareNewContactStep(scope:any,step:any,person:any){
  if(scope.batchType!=='new_contact_free')return null;
  if(!scope.people.some((p:any)=>p.personId===person.personId&&p.companyId===person.companyId)||scope.excludedPersonIds.includes(person.personId))throw Error('NEW_CONTACT_ONLY_PREVIOUS_PERSON_EXCLUDED');
  if(step.kind!=='verify')return null;
  const email=String(step.input.email||'').toLowerCase();
  const previous=await personJournal(scope,j=>(Object.values(j.operations||{}) as any[]).findLast((o:any)=>o.state==='done'&&o.result?.email?.toLowerCase()===email&&o.result?.technical)?.result);
  const known=(scope.emailResults||[]).findLast((r:any)=>r.email?.toLowerCase()===email&&r.technical);
  if(previous||known)return {result:{...structuredClone(previous||known),notice:'复用该邮箱已有验证回执，本批未重复扣费；归属仍需核对。'}};
  if(scope.knownEmails.includes(email))throw Error('PREVIOUS_EMAIL_NO_NEW_VERIFICATION');
  return null;
}
