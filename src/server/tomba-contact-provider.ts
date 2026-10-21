import 'server-only';
import {personJournal,reservePersonUsage} from './person-research-runner';
const routes=['/v1/enrich','/v1/domain-search','/v1/email-finder','/v1/email-sources'];
const normal=(v:string)=>String(v||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const profile=(v:string)=>String(v||'').replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/$/,'').toLowerCase();
export async function tombaRequest(step:any,person:any,scope:any,record:(v:any)=>Promise<void>,fetcher:typeof fetch=fetch,
  keys={key:process.env.TOMBA_API_KEY||'',secret:process.env.TOMBA_SECRET_KEY||''}){
  const route=step.input.endpoint,call=scope.tombaCalls?.find((c:any)=>c.personId===person.personId&&c.endpoint===route);
  if(scope.batchType!=='free_tomba'||!routes.includes(route)||!call||!keys.key||!keys.secret)throw Object.assign(Error('TOMBA_APPROVED_INPUT_REQUIRED'),{status:403});
  const params:Record<string,string>={};
  if(route==='/v1/enrich'||route==='/v1/email-sources'){
    if(call.email!=='ap@maxx-coffee.id')throw Object.assign(Error('TOMBA_AP_ONLY'),{status:403});params.email=call.email;
  }else{
    if(call.domain!=='iloveserenitea.com')throw Object.assign(Error('TOMBA_SERENITEA_ONLY'),{status:403});params.domain=call.domain;
    if(route==='/v1/domain-search')params.limit='10';
    else {if(!['Juliet Herrera','Peter Chen','Krysha Mae Cornista'].includes(person.name))throw Object.assign(Error('TOMBA_PERSON_NOT_APPROVED'),{status:403});params.full_name=person.name;}
  }
  if(route!=='/v1/email-sources')params.enrich_mobile='false';
  const url=new URL(route,'https://api.tomba.io');for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
  await personJournal(scope,j=>{
    const u=j.tombaUsage||={searchRequests:0,sourcesRequests:0,httpRequests:0,requests:[]},sources=route==='/v1/email-sources',key=sources?'sourcesRequests':'searchRequests';
    if(Date.now()>=Date.parse(scope.notAfter)||u[key]>=(sources?1:5)||sources&&!scope.tombaSourcesFree||u.requests.some((r:any)=>r.route===route&&r.personId===person.personId))throw Object.assign(Error('TOMBA_LIMIT_OR_PREVIOUS_REQUEST'),{status:403});
    u[key]++;u.httpRequests++;u.requests.push({route,personId:person.personId,params,at:new Date().toISOString()});
  });
  await reservePersonUsage(scope,'tomba-http:'+route+':'+person.personId,{network:1});
  await record({stage:'send_started',route,method:'GET',params});
  let response:Response;try{response=await fetcher(url,{method:'GET',headers:{'X-Tomba-Key':keys.key,'X-Tomba-Secret':keys.secret},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('TOMBA_NETWORK_RESULT_UNKNOWN');}
  const rawText=await response.text();if(rawText.length>4000000)throw Error('TOMBA_RESPONSE_TOO_LARGE');
  const rateHeaders=Object.fromEntries([...response.headers].filter(([k])=>/rate|remaining|retry-after/i.test(k)));
  await record({stage:'body_received',route,httpStatus:response.status,rateHeaders,rawResponse:rawText.replaceAll(keys.key,'[redacted]').replaceAll(keys.secret,'[redacted]')});
  if(!response.ok)throw Object.assign(Error('TOMBA_HTTP_'+response.status),{status:response.status>=500?'待核实':response.status});
  let raw:any;try{raw=JSON.parse(rawText);}catch{throw Error('TOMBA_RESPONSE_NOT_JSON');}
  return {...raw,httpStatus:response.status};
}
export function tombaResult(step:any,person:any,scope:any,raw:any,now=new Date().toISOString()){
  const route=step.input.endpoint,people:any[]=[],channels:any[]=[],data=route==='/v1/domain-search'?raw.data?.emails||[]:route==='/v1/email-sources'?[]:[raw.data||{}];
  const candidates=route==='/v1/domain-search'?scope.tombaPeople.filter((p:any)=>p.companyId!==scope.ownershipCompanyId):[person];
  for(const value of data){
    const email=String(value.email||'').toLowerCase(),name=value.full_name||[value.first_name,value.last_name].filter(Boolean).join(' ');
    if(!/^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(email))continue;
    const matched=candidates.filter((p:any)=>normal(p.name)===normal(name)),p=matched.length===1?matched[0]:null;
    const profileConflict=!!p?.profileUrl&&!!value.linkedin&&profile(p.profileUrl)!==profile(value.linkedin);
    const generic=value.type==='generic'||/^(info|hello|contact|support|sales|admin|office|hr|careers)@/.test(email);
    const owned=route!=='/v1/enrich'&&!!p&&!profileConflict&&!generic&&email.endsWith('@iloveserenitea.com');
    const evidence=[{sourceUrl:'https://api.tomba.io'+route,sourceType:'provider_receipt',retrievedAt:now,
      quote:JSON.stringify({provider:'tomba',requestedName:person.name,returnedName:name,returnedProfile:value.linkedin||null,profileConflict,email,providerEmailStatus:value.verification?.status||null,acceptAll:value.accept_all,sources:value.sources||[]})}];
    const contact={kind:'email',value:email,scope:owned?'person':generic?'company':'unknown',ownership:'provider_candidate',verification:'unverified',provenance:'provider_match',channelEmployer:value.company||person.companyName,evidence};
    if(owned)people.push({name:p.name,personId:p.personId,contacts:[contact],evidence,relationship:'unknown',employerVerified:false,detailUnknowns:['供应商候选，技术有效性及人物归属分别核实。']});
    else channels.push(contact);
  }
  return {provider:'tomba',state:people.length?'provider_candidate':channels.length?'identity_ambiguous':'not_found',people,channels,observation:raw,
    notice:route==='/v1/enrich'?'邮箱反查线索已保存；同名和主页冲突未自动解除。':'新来源回执已保存；未确认的邮箱不标成有效，未匹配原名单的人物不新增。'};
}
