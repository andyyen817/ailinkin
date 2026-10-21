import 'server-only';
import {activeGrant,type SourceGrant} from './source-permissions';
import {finderEndpoints} from './contact-provider-finders';
export type ContactSource={id:string;provider:'apollo'|'hunter'|'dropcontact'|'prospeo'|'tomba'|'public'|'langsearch'|'deepseek';endpoint:string;tenantId:string;
  verifiedAt:string;expiresAt:string;eligible:boolean;purpose:'internal_test'|'commercial_saas';evidenceId:string;
  cacheDays:number;modelTransfer:boolean;fields:string[];disabledReason?:string;maxCostUsd?:number};
export function sourceAllowed(source:ContactSource|undefined,tenantId:string,grants:SourceGrant[]=[],now=Date.now()){
  if(!source||source.tenantId!==tenantId||!source.eligible||source.disabledReason||!source.evidenceId?.trim())return false;
  if(!Number.isFinite(Date.parse(source.verifiedAt))||Date.parse(source.verifiedAt)>now||Date.parse(source.expiresAt)<=now||!Number.isFinite(Date.parse(source.expiresAt)))return false;
  return source.purpose==='internal_test'||!!activeGrant(source.provider,grants,now)?.commercialDisplay;
}
export function contactCapabilities(scope:any,tenantId:string,now=Date.now()){
  const sources:ContactSource[]=scope?.tenantId===tenantId?scope.sources||[]:[];
  return sources.map(s=>({id:s.id,provider:s.provider,endpoint:s.endpoint,fields:s.fields||[],
    available:sourceAllowed(s,tenantId,scope.grants,now),notice:s.disabledReason||(!s.eligible?'接口资格尚未核实':'以本连接许可及期限为准')}));
}
export function qualifiedSource(scope:any,provider:string,endpoint:string,fields:string[]=[]){
  return (scope?.sources||[]).find((s:ContactSource)=>s.provider===provider&&s.endpoint===endpoint&&sourceAllowed(s,scope.tenantId,scope.grants)&&fields.every(f=>s.fields?.includes(f)));
}
export const personStepEndpoints:Record<string,[string,string]>={apollo:['apollo','/api/v1/people/match'],discover:['apollo','/api/v1/mixed_people/api_search'],finder:['hunter','/v2/email-finder/found'],verify:['hunter','/v2/email-verifier'],page:['public','page'],search:['langsearch','/v1/web-search'],model:['deepseek','analysis']};
export function personStepSource(scope:any,step:any,person:any){
  let [provider,endpoint]=personStepEndpoints[step.kind]||[];
  if(step.kind==='finder'&&step.input.provider){
    provider=step.input.provider;endpoint=provider==='tomba'&&['/v1/enrich','/v1/domain-search','/v1/email-finder','/v1/email-sources'].includes(step.input.endpoint)?step.input.endpoint:finderEndpoints[provider];
    if(!endpoint)return null;
  }
  const fields=step.input.fields||(['finder','verify'].includes(step.kind)?['work_email']:step.kind==='discover'?['career']:person.missing||person.fields||[]);
  const source=(scope.sources||[]).find((s:ContactSource)=>s.id===step.input.sourceId&&s.provider===provider&&s.endpoint===endpoint);
  if(!sourceAllowed(source,scope.tenantId,scope.grants)||!fields.length||!fields.every((f:string)=>source.fields?.includes(f)))return null;
  if(step.kind==='model'&&!source.modelTransfer)return null;
  if(['finder','verify'].includes(step.kind)&&(!Number.isFinite(source.maxCostUsd)||source.maxCostUsd<0))return null;
  return source as ContactSource;
}
export function commercialScopeValid(s:any,now=Date.now()){
  const n=(v:any,max:number)=>Number.isFinite(v)&&v>=0&&v<=max;
  return !!(s.mode==='commercial'&&s.enabled&&s.id&&s.tenantId&&s.actorId&&s.policyEvidenceId&&
    Array.isArray(s.people)&&s.people.length>0&&Number.isInteger(s.maxPeople)&&s.maxPeople>0&&s.maxPeople<=200&&
    n(s.minutes,1440)&&s.minutes>0&&Date.parse(s.notAfter)>now&&s.journalCampaignId&&
    s.send===false&&s.purchase===false&&s.phoneReveal===false&&s.waterfall===false&&
    ['searches','pages','network','images','models','usd','apollo','finder','verifications'].every(k=>n(s.limits?.[k],100000))&&
    Array.isArray(s.sources)&&s.sources.every((c:ContactSource)=>c.tenantId===s.tenantId&&Array.isArray(c.fields)&&Number.isFinite(c.cacheDays)&&c.cacheDays>=0&&c.cacheDays<=30)&&
    (!s.limits.searches||Date.parse(s.freeQuotaVerifiedAt)<=now&&now-Date.parse(s.freeQuotaVerifiedAt)<86400000));
}
export function contactCacheKey(input:{tenantId:string;sourceId:string;personId:string;action:string;fields:string[];version:string}){
  return JSON.stringify([input.tenantId,input.sourceId,input.personId,input.action,[...input.fields].sort(),input.version]);
}
