import {personJournal,reservePersonUsage} from './person-research-runner';
const finders=['PI-86b709862ab0884359a1006264554d1f','PI-8aaa34e4c3b17b63169c2c92de8d8ec1','PI-e2b3b42abd7ff9bdaecac3d266fe2fe0'];
const adnan='PI-3219d25f121bf56d27f9f6ca71e08677',karen='PI-083871607aebedbd08a6dc56988e6792';
export function freeTombaScope(s:any){
  if(s?.batchType!=='free_tomba'||s.id!=='CONTACT-OWNERSHIP-20261017'||!s.tombaApprovalEvidence||!s.renewalEvidence)return null;
  const people=(s.targets||[]).flatMap((t:any)=>(t.personIds||[]).map((personId:string)=>({campaignId:t.campaignId,companyId:t.companyId,personId})));
  const manual=s.tombaManualPagesUsed||0;if(!Number.isInteger(manual)||manual<0||manual>10)return null;
  const limits={searches:40,pages:16-manual,network:139,images:0,models:0,usd:0,apollo:0,finder:30,verifications:23};
  const routes=['tomba:/v1/enrich','tomba:/v1/domain-search','tomba:/v1/email-finder','tomba:/v1/email-sources','hunter:/v2/email-verifier','public:page'];
  const q=s.tombaQualification;if(!q||typeof q.tombaFree!=='boolean'||typeof q.hunterFree!=='boolean'||typeof q.sourcesFree!=='boolean')return null;
  const sources=routes.map((route,index)=>{const [provider,endpoint]=route.split(':'),ready=provider==='public'||provider==='hunter'&&q.hunterFree||provider==='tomba'&&q.tombaFree&&(endpoint!=='/v1/email-sources'||q.sourcesFree);
    return {id:'tomba-phase-'+index,provider,endpoint,tenantId:s.tenantId,verifiedAt:q.checkedAt||s.renewedAt,expiresAt:s.notAfter,eligible:!!ready,purpose:'internal_test',evidenceId:s.tombaApprovalEvidence,cacheDays:7,modelTransfer:false,fields:['work_email'],maxCostUsd:0,...(ready?{}:{disabledReason:'免费账户或对应免费积分尚未核实，未提交查询'})};});
  s={...s,sources};
  if(people.length!==26||new Set(people.map((p:any)=>p.personId)).size!==26||s.maxPeople!==26||s.minutes!==100||s.manualPageLimit!==1+manual||s.hunterCreditLimit!==5||
    !Object.entries(limits).every(([k,v])=>s.limits?.[k]===v)||s.sources?.length!==6||new Set(s.sources.map((v:any)=>v.provider+':'+v.endpoint)).size!==6||
    s.sources.some((v:any)=>!routes.includes(v.provider+':'+v.endpoint)||v.maxCostUsd!==0||v.modelTransfer!==false||v.fields?.join(',')!=='work_email')||
    !Array.isArray(s.knownEmails)||s.knownEmails.length!==20||s.otherKnownEmails?.length!==37||new Set([...s.knownEmails,...s.otherKnownEmails]).size!==57||
    s.exportTargets?.length!==3||s.sharedEmails?.length!==3)return null;
  const calls=s.tombaCalls;if(calls?.length!==6||new Set(calls.map((c:any)=>c.endpoint+':'+c.personId)).size!==6||calls.some((c:any)=>!people.some((p:any)=>p.personId===c.personId)))return null;
  if(!['/v1/enrich','/v1/email-sources'].every(endpoint=>calls.some((c:any)=>c.endpoint===endpoint&&c.personId===adnan&&c.email==='ap@maxx-coffee.id'))||
    !calls.some((c:any)=>c.endpoint==='/v1/domain-search'&&c.personId===karen&&c.domain==='iloveserenitea.com')||
    !finders.every(id=>calls.some((c:any)=>c.endpoint==='/v1/email-finder'&&c.personId===id&&c.domain==='iloveserenitea.com')))return null;
  if(Object.values(s.publicUrls||{}).some((urls:any)=>!Array.isArray(urls)||urls.some((url:any)=>typeof url!=='string'||!/^https?:\/\//.test(url))))return null;
  return {...s,people,tombaSourcesFree:q.tombaFree&&q.sourcesFree,knownEmails:[...s.knownEmails,...s.otherKnownEmails]};
}
export async function tombaHunterFetch(scope:any,input:RequestInfo|URL,init?:RequestInit,fetcher:typeof fetch=fetch){
  const url=new URL(String(input)),email=url.searchParams.get('email')?.toLowerCase();
  if(url.origin!=='https://api.hunter.io'||url.pathname!=='/v2/email-verifier'||(init?.method||'GET')!=='GET'||!email||scope.knownEmails.includes(email))throw Object.assign(Error('TOMBA_NEW_EMAIL_VERIFIER_ONLY'),{status:403});
  await personJournal(scope,j=>{const u=j.tombaHunterUsage||={requests:0,emails:[]};if(u.requests>=10||u.emails.includes(email)||Date.now()>=Date.parse(scope.notAfter))throw Object.assign(Error('TOMBA_HUNTER_LIMIT'),{status:403});u.requests++;u.emails.push(email);});
  await reservePersonUsage(scope,'tomba-hunter-http:'+email,{network:1});return fetcher(input,init);
}
