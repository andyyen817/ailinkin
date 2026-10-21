import {freeEmailOwnershipScope} from './free-email-ownership-scope';
import {personJournal} from './person-research-runner';
export function freeContactAlternativeScope(s:any){
  if(s?.batchType!=='free_contact_alternative'||!s.alternativeApprovalEvidence||!s.renewalEvidence)return null;
  const limits={searches:40,pages:39,network:256,images:0,models:0,usd:0,apollo:0,finder:24,verifications:20};
  const routes=['hunter:/v2/email-verifier','dropcontact:/v1/enrich/all','public:page'];
  if(!Object.entries(limits).every(([k,v])=>s.limits?.[k]===v)||s.manualPageLimit!==1||s.hunterCreditLimit!==10||s.dropcontactCreditLimit!==24||
    s.sources?.length!==3||new Set(s.sources.map((v:any)=>v.provider+':'+v.endpoint)).size!==3||s.sources.some((v:any)=>!routes.includes(v.provider+':'+v.endpoint)||v.maxCostUsd!==0||v.fields?.join(',')!=='work_email'||v.modelTransfer!==false)||
    !Array.isArray(s.otherKnownEmails)||!Array.isArray(s.knownEmails)||new Set([...s.knownEmails,...s.otherKnownEmails]).size!==s.knownEmails.length+s.otherKnownEmails.length||[...s.knownEmails,...s.otherKnownEmails].some((v:string)=>!/^\S+@\S+\.\S+$/.test(v)))return null;
  const normalized={...s,batchType:'free_email_ownership',limits:{...limits,pages:16,finder:0},manualPageLimit:24,publicStage:'initial',queryOverrides:undefined,
    sources:s.sources.map((v:any)=>v.provider==='dropcontact'?{...v,provider:'langsearch',endpoint:'/v1/web-search'}:v)};
  const base=freeEmailOwnershipScope(normalized);if(!base)return null;
  const ids=s.dropcontactPersonIds,excluded=s.previouslyCheckedDropcontactPersonIds;
  if(!Array.isArray(ids)||ids.length!==24||new Set(ids).size!==24||ids.some((id:string)=>!base.people.some((p:any)=>p.personId===id))||
    !Array.isArray(excluded)||excluded.length!==2||new Set(excluded).size!==2||excluded.some((id:string)=>ids.includes(id)||!base.people.some((p:any)=>p.personId===id))||s.publicUrls&&Object.values(s.publicUrls).some((urls:any)=>!Array.isArray(urls)||urls.some((url:any)=>typeof url!=='string'||!/^https?:\/\//.test(url))))return null;
  return {...s,knownEmails:[...s.knownEmails,...s.otherKnownEmails],people:base.people};
}
export async function alternativeProviderFetch(scope:any,input:RequestInfo|URL,init?:RequestInit,fetcher:typeof fetch=fetch){
  const url=new URL(String(input)),method=(init?.method||'GET').toUpperCase();
  if(scope.batchType!=='free_contact_alternative'||url.origin!=='https://api.dropcontact.com'||url.search||
    !(method==='POST'&&url.pathname==='/v1/enrich/all'||method==='GET'&&/^\/v1\/enrich\/all\/[a-zA-Z0-9_-]{1,150}$/.test(url.pathname)))throw Error('ALTERNATIVE_PROVIDER_ROUTE_DENIED');
  if(method==='POST'){const body=JSON.parse(String(init?.body||''));
    if(!Array.isArray(body.data)||body.data.length!==1||Object.keys(body).some(k=>!['data','language'].includes(k))||Object.keys(body.data[0]).sort().join(',')!=='company,full_name,website')throw Error('ALTERNATIVE_SINGLE_PERSON_EMAIL_INPUT_REQUIRED');}
  await personJournal(scope,j=>{
    const count=j.alternativeProviderUsage||={posts:0,gets:0,requests:[]};
    const key=method==='POST'?'posts':'gets',max=method==='POST'?24:72;
    if(Date.now()>=Date.parse(scope.notAfter)||count[key]>=max)throw Error('ALTERNATIVE_PROVIDER_HTTP_LIMIT');
    count[key]++;count.requests.push({method,path:url.pathname,at:new Date().toISOString()});
  });
  return fetcher(input,init);
}
