import 'server-only';
import {personStepSource,contactCacheKey} from './contact-source-policy';
import {standardApolloEnrichment} from './person-research-apollo';import {apolloDiscoveryInput} from './contact-apollo-normalize';
import {findPublishedEmail,verifyCandidateEmail,hunterRequest} from './person-email-provider';import {personHash} from './person-research-selection';
import {reusableFieldObservation,recordFieldObservation} from './person-research-ledger';
import {limitPersonFields} from './person-public-extraction';
import {finderRequest,normalizeFinder} from './contact-provider-finders';
import {tombaRequest,tombaResult} from './tomba-contact-provider';
export function prepareStandardPersonStep(step:any,person:any,context:any){
  const {scope,batch}=context,source=personStepSource(scope,step,person);
  if(!source)throw Object.assign(Error('SOURCE_QUALIFICATION_REQUIRED'),{status:403});
  const input={...step.input};delete input.continuation;if(input.email)input.email=input.email.toLowerCase();
  const finder=step.kind==='finder'&&!!step.input.provider,verify=step.kind==='verify';
  const key=contactCacheKey({tenantId:scope.tenantId,sourceId:source.id,personId:person.personId,action:step.kind+':'+personHash(input),fields:input.fields||person.fields||[],version:finder?personHash([person.companyId,person.name,person.domain]):verify?personHash([person.companyId,input.email]):person.basisHash||personHash([person.companyId,person.domain])});
  const observations=[...(context.previousObservations||[]),...(batch.fieldObservations||[])];
  let prior=source.cacheDays>0?reusableFieldObservation(observations,key,scope.tenantId,source.id):null;
  if(!prior&&(finder||verify)&&source.cacheDays>0){
    const receiptKey=verify?personHash([source.id,source.endpoint,{email:input.email}]):personHash([source.id,source.endpoint,person.personId,person.name,person.domain]);
    const received=[...(context.previousReceipts||[]),...(batch.providerReceipts||[])].some((r:any)=>r.key===receiptKey&&r.state==='received');
    if(received)prior=observations.findLast((r:any)=>{try{return r.tenantId===scope.tenantId&&r.sourceId===source.id&&['done','not_found'].includes(r.state)&&r.result?.state!=='provider_pending'&&Date.parse(r.expiresAt)>Date.now()&&JSON.stringify(JSON.parse(r.key).slice(0,5))===JSON.stringify(JSON.parse(key).slice(0,5));}catch{return false;}});
  }
  return {source,key,...(prior&&!(step.input.continuation&&prior.result?.state==='provider_pending')?{result:structuredClone(prior.result)}:{})};
}
export async function executeStandardPersonStep(step:any,person:any,context:any){
  const {scope,batch,save,call}=context,prepared=prepareStandardPersonStep(step,person,context),{source,key}=prepared,endpoint=source.endpoint;
  if('result' in prepared)return prepared.result;
  if(scope.cacheOnly)throw Object.assign(Error('CONTACT_CACHE_MISS_NO_EXTERNAL_ALLOWED'),{status:403});
  const observations=batch.fieldObservations||=[];
  const hunter=async(route:string,params:Record<string,string>)=>{
    if(!Number.isFinite((source as any).maxCostUsd))throw Object.assign(Error('HUNTER_COST_UNVERIFIED'),{status:403});
    const receipt={key:personHash([source.id,route,params]),sourceId:source.id,route,state:'reserved',stages:[{stage:'send_started',at:new Date().toISOString()}]} as any;
    if([...(context.previousReceipts||[]),...(batch.providerReceipts||[])].some((r:any)=>r.key===receipt.key&&['unknown','reserved'].includes(r.state)))throw Object.assign(Error('HUNTER_PREVIOUS_RESULT_UNKNOWN'),{status:'待核实'});
    (batch.providerReceipts||=[]).push(receipt);await save();
    try{const raw=await hunterRequest(route,params,process.env.HUNTER_API_KEY||'',context.hunterFetcher||fetch,async response=>{Object.assign(receipt,response);receipt.stages.push({stage:response.rawResponse===undefined?'http_received':'body_received',at:new Date().toISOString()});await save();});receipt.raw=raw;receipt.state='received';await save();return raw;}
    catch(e){receipt.state=typeof (e as any).status==='number'?'failed':'unknown';receipt.error=(e as Error).message;await save();throw e;}
  };
  let result:any;
  if(step.kind==='apollo')result=await standardApolloEnrichment(person,scope,call);
  else if(step.kind==='finder'&&step.input.provider==='tomba'){
    const receipt:any={key:personHash([source.id,endpoint,person.personId]),sourceId:source.id,route:endpoint,state:'reserved',stages:[]};
    if([...(context.previousReceipts||[]),...(batch.providerReceipts||[])].some((r:any)=>r.key===receipt.key&&['unknown','reserved','failed'].includes(r.state)))throw Object.assign(Error('TOMBA_PREVIOUS_RESULT_REQUIRES_RECONCILIATION'),{status:409});
    (batch.providerReceipts||=[]).push(receipt);await save();
    try{const raw=await tombaRequest(step,person,scope,async value=>{receipt.stages.push({...value,at:new Date().toISOString()});await save();});result=tombaResult(step,person,{...scope,tombaPeople:batch.people},raw);receipt.state='received';await save();}
    catch(e){receipt.state=typeof (e as any).status==='number'?'failed':'unknown';receipt.error=(e as Error).message;await save();throw e;}
  }
  else if(step.kind==='finder'&&step.input.provider){
    const keyName=({hunter:'HUNTER_API_KEY',dropcontact:'DROPCONTACT_API_KEY',prospeo:'PROSPEO_API_KEY'} as Record<string,string>)[source.provider];
    const credential=process.env[keyName]||'';
    if(!credential)throw Object.assign(Error('FINDER_CREDENTIAL_UNAVAILABLE'),{status:403});
    const receipt:any={key:personHash([source.id,endpoint,person.personId,person.name,person.domain]),sourceId:source.id,
      provider:source.provider,route:endpoint,state:'reserved',stages:[]};
    if([...(context.previousReceipts||[]),...(batch.providerReceipts||[])].some((r:any)=>r.key===receipt.key&&['unknown','reserved','failed'].includes(r.state)))
      throw Object.assign(Error('FINDER_PREVIOUS_RESULT_REQUIRES_RECONCILIATION'),{status:'待核实'});
    const pending=step.input.continuation?[...(context.previousReceipts||[]),...(batch.providerReceipts||[])].findLast((r:any)=>r.key===receipt.key&&r.state==='pending'&&r.providerRequestId):null;
    if(step.input.continuation&&(!pending||source.provider!=='dropcontact'))throw Object.assign(Error('FINDER_ORIGINAL_REQUEST_REQUIRED'),{status:409});
    (batch.providerReceipts||=[]).push(receipt);await save();
    try{
      const record=async(value:any)=>{const safe=JSON.parse(JSON.stringify(value).replaceAll(credential,'[redacted]'));
        receipt.stages.push({...safe,at:new Date().toISOString()});if(safe.providerRequestId)receipt.providerRequestId=safe.providerRequestId;await save();};
      const raw=await finderRequest(source.provider,person,credential,context.finderFetcher||fetch,record,context.finderSleep,pending?.providerRequestId);
      result=normalizeFinder(source.provider,person,raw);receipt.state=raw.providerPending?'pending':'received';receipt.resultState=result.state;await save();
    }catch(e){receipt.state=typeof (e as any).status==='number'?'failed':'unknown';receipt.error=(e as Error).message;await save();throw e;}
  }
  else if(step.kind==='finder')result=await findPublishedEmail(person,scope,hunter);
  else if(step.kind==='verify')result={state:'verified',email:step.input.email,technical:await verifyCandidateEmail(step.input.email,hunter),people:[],channels:[]};
  else if(step.kind==='discover'){
    const raw=await call('apollo',endpoint,apolloDiscoveryInput(person.domain,step.input.page));
    const people=(raw.people||[]).map((p:any)=>({providerId:p.id,name:p.name||[p.first_name,p.last_name].filter(Boolean).join(' '),nameMasked:!p.last_name||!!p.last_name_obfuscated,title:p.title||'',relationship:'unknown',employerVerified:false,
      evidence:[{sourceUrl:'https://www.apollo.io',quote:JSON.stringify({id:p.id,first_name:p.first_name,last_name:p.last_name,last_name_obfuscated:p.last_name_obfuscated,title:p.title,organization:p.organization?.name}),retrievedAt:new Date().toISOString()}]}));
    const total=raw.pagination?.total_pages;result={state:'discovered',people,channels:[],observation:raw,nextPage:Number.isInteger(total)&&total>step.input.page?step.input.page+1:null};
  }else result=await context.executePublic(step,person);
  const fields=step.input.fields||person.fields||[];
  result=limitPersonFields(result,fields);
  call.commit?.();
  if(source.cacheDays>0&&!result?.technical?.pending&&result?.state!=='provider_pending'){
    const entry={key,tenantId:scope.tenantId,sourceId:source.id,state:result.state==='not_found'?'not_found':'done',result,expiresAt:new Date(Date.now()+Math.min(source.cacheDays,30)*86400000).toISOString()};
    recordFieldObservation(observations,entry);batch.fieldObservations=observations;
  }
  await save();return result;
}
