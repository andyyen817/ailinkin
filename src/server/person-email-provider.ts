import 'server-only';
import {qualifiedSource} from './contact-source-policy';
export type EmailCheck={status:string;requestedAt:string;verifiedAt:string|null;expiresAt:string|null;rawStatus:string;provider:string;email:string;pending:boolean};
export function normalizeEmailCheck(email:string,raw:any,requestedAt=new Date().toISOString()):EmailCheck{
  const d=raw.data||{},date=d.verification?.date||d.verification_date||d.verified_at||null;
  const pending=raw.httpStatus===202;
  if((d.email||!pending)&&String(d.email||'').toLowerCase()!==email.toLowerCase())throw Error('EMAIL_VERIFICATION_ADDRESS_MISMATCH');
  const verifiedAt=date&&Number.isFinite(Date.parse(date))&&Date.parse(date)<=Date.parse(requestedAt)?new Date(date).toISOString():null;
  const status=!pending&&['valid','invalid','accept_all','webmail','disposable','unknown'].includes(d.status)?d.status:'unknown';
  return {email,status:status==='accept_all'?'catch_all':status,rawStatus:d.status||'unknown',provider:'hunter',requestedAt,verifiedAt,
    expiresAt:verifiedAt?new Date(Date.parse(verifiedAt)+7*86400000).toISOString():null,pending};
}
export async function hunterRequest(endpoint:string,params:Record<string,string>,key:string,fetcher:typeof fetch=fetch,receipt?:(raw:any)=>Promise<void>){
  if(!key||!['/v2/email-finder/found','/v2/email-verifier','/v2/domain-search'].includes(endpoint))throw Error('HUNTER_ENDPOINT_OR_KEY_UNAVAILABLE');
  const url=new URL(endpoint,'https://api.hunter.io');for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  url.searchParams.set('api_key',key);
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
  await receipt?.({httpStatus:response.status});
  const body=await response.text();if(body.length>4000000)throw Error('HUNTER_RESPONSE_TOO_LARGE');
  await receipt?.({httpStatus:response.status,rawResponse:body});
  if(!response.ok&&response.status!==202)throw Object.assign(Error('HUNTER_HTTP_'+response.status),{status:response.status>=500?'待核实':response.status});
  return {...JSON.parse(body),httpStatus:response.status};
}
export async function findPublishedEmail(person:any,scope:any,call:(endpoint:string,params:Record<string,string>)=>Promise<any>){
  const endpoint='/v2/email-finder/found';if(!qualifiedSource(scope,'hunter',endpoint))return {state:'qualification_unverified',people:[],channels:[]};
  if(!person.emailDomainVerified||!person.emailDomain)return {state:'domain_unverified',people:[],channels:[],notice:'尚无已证实的雇主邮件域名，未调用查找'};
  const raw=await call(endpoint,{domain:person.emailDomain,full_name:person.name}),d=raw.data||{};
  const sources=(d.sources||[]).filter((s:any)=>/^https?:\/\//.test(s.uri||''));
  if(!d.email||!sources.length)return {state:'not_found',people:[],channels:[],observation:raw};
  const returnedName=d.full_name||[d.first_name,d.last_name].filter(Boolean).join(' '),normal=(v:string)=>v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  if(returnedName&&normal(returnedName)!==normal(person.name))return {state:'identity_ambiguous',people:[],channels:[],observation:raw,notice:'供应商返回姓名不匹配，未绑定邮箱'};
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)||d.email.split('@')[1].toLowerCase()!==person.emailDomain.toLowerCase())return {state:'identity_ambiguous',people:[],channels:[],observation:raw,notice:'邮箱域名不匹配，未绑定人物'};
  const evidence=sources.map((s:any)=>({sourceUrl:s.uri,quote:JSON.stringify({requestedName:person.name,returnedName:returnedName||null,email:d.email,domain:person.emailDomain,providerLastSeenOn:s.last_seen_on||null}),sourceType:'provider_receipt',retrievedAt:new Date().toISOString()}));
  return {state:'published_candidate',observation:raw,people:[{name:person.name,relationship:'unknown',evidence,
    contacts:[{kind:'email',value:d.email,scope:'person',ownership:'provider_candidate',verification:'unverified',provenance:'published',channelEmployer:person.companyName,evidence}]}],channels:[]};
}
export async function verifyCandidateEmail(email:string,call:(endpoint:string,params:Record<string,string>)=>Promise<any>,polls=2){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('EMAIL_INVALID');
  const requestedAt=new Date().toISOString();let raw:any;
  for(let i=0;i<=Math.min(2,Math.max(0,polls));i++){
    raw=await call('/v2/email-verifier',{email});
    if(raw.httpStatus!==202)break;
    if(i<polls)await new Promise(r=>setTimeout(r,250));
  }
  return {...normalizeEmailCheck(email,raw,requestedAt),raw};
}
