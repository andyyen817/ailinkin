import 'server-only';
import {personHash} from './person-research-selection';
import {standardApolloInput,normalizeApolloPerson} from './contact-apollo-normalize';
import {qualifiedSource} from './contact-source-policy';
export async function standardApolloEnrichment(person:any,scope:any,call:any){
  if(!qualifiedSource(scope,'apollo','/api/v1/people/match'))return {state:'qualification_unverified',people:[],channels:[]};
  const raw=await call('apollo','/api/v1/people/match',standardApolloInput(person));
  return {...normalizeApolloPerson(person,raw),sourceDigest:personHash(raw)};
}
const normal=(s:string)=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function domain(value:string){try{return new URL(value.includes('://')?value:'https://'+value).hostname.replace(/^www\./,'');}catch{return '';}}
export function namedApolloInput(person:any){
  const names=String(person.name||'').trim().split(/\s+/);if(names.length<2)throw Error('PERSON_FULL_NAME_REQUIRED');
  return {first_name:names[0],last_name:names.slice(1).join(' '),organization_name:person.companyName,
    ...(domain(person.domain)?{domain:domain(person.domain)}:{}),...(person.profileUrl?.includes('linkedin.com/in/')?{linkedin_url:person.profileUrl}:{}),
    reveal_personal_emails:false,reveal_phone_number:false,run_waterfall_email:false,run_waterfall_phone:false};
}
export async function namedApolloEnrichment(person:any,scope:any,call:any){
  const eligibility=scope?.apolloEligibility;
  if(!eligibility?.eligible||eligibility.endpoint!=='/api/v1/people/match'||Date.now()-Date.parse(eligibility.verifiedAt)>86400000)return {state:'qualification_unverified',people:[],channels:[],notice:'Apollo接口资格尚未核实，未调用也未扣积分'};
  const raw=await call('apollo','/api/v1/people/match',namedApolloInput(person)),p=raw.person;
  if(!p)return {state:'not_found',people:[],channels:[]};
  const sameName=normal(p.name||[p.first_name,p.last_name].filter(Boolean).join(' '))===normal(person.name),sameCompany=normal(p.organization?.name)===normal(person.companyName)||!!domain(person.domain)&&domain(p.organization?.website_url||'')===domain(person.domain);
  const evidence=[{sourceUrl:p.linkedin_url||p.organization?.website_url||'https://www.apollo.io',quote:JSON.stringify({name:p.name,title:p.title,organization:p.organization?.name,email:p.email,email_status:p.email_status}),retrievedAt:new Date().toISOString()}];
  const contacts:any[]=[];
  if(sameName&&sameCompany&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email||'')&&!/@(?:gmail|yahoo|hotmail|outlook|icloud)\./i.test(p.email))contacts.push({kind:'email',value:p.email,scope:'person',verification:'provider_work_email_candidate',evidence});
  const channels=p.organization?.phone?[{kind:'phone',value:p.organization.phone,scope:'company',verification:'provider_company_phone',evidence}]:[];
  return {state:sameName&&sameCompany?'matched_candidate':'identity_ambiguous',providerId:p.id,matchConfidence:p.match_confidence||'not_provided',
    people:sameName?[{...p,name:person.name,sourcePersonId:person.sourcePersonId,profileUrl:p.linkedin_url,contacts,evidence,employerVerified:false,relationship:'unknown',employerClaim:p.organization?.name||''}]:[],channels,
    observation:raw,sourceDigest:personHash(raw),notice:'供应商匹配不等于现任核实或邮箱有效验证；公司电话单独保留'};
}
