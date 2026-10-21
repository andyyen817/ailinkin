import 'server-only';
import {companyDomain} from './contact-provider-finders';
export const companyPathActions=['hunter_domain','prospeo_company','prospeo_people'] as const;
export type CompanyPathAction=typeof companyPathActions[number];
export const companyPathRoutes={hunter_domain:'/v2/domain-search',prospeo_company:'/enrich-company',prospeo_people:'/search-person'};
export function companyPathRequest(action:CompanyPathAction,domain:string,key:string,page=1){
  if(!Number.isInteger(page)||page<1||page>1000||action!=='prospeo_people'&&page!==1)throw Error('COMPANY_PATH_PAGE_INVALID');
  if(!key||!companyDomain(domain)||companyDomain(domain)!==domain)throw Error('COMPANY_PATH_INPUT_INVALID');
  const hunter=action==='hunter_domain',url=new URL(companyPathRoutes[action],hunter?'https://api.hunter.io':'https://api.prospeo.io');
  if(hunter)for(const [k,v] of Object.entries({domain,limit:'2',type:'personal',required_field:'full_name',api_key:key}))url.searchParams.set(k,v);
  return {url,options:{method:hunter?'GET':'POST',headers:new Headers(hunter?{}:{'Content-Type':'application/json','X-KEY':key}),
    ...(!hunter?{body:JSON.stringify(action==='prospeo_company'?{data:{company_website:domain}}:{page,filters:{company:{websites:{include:[domain]}}}})}:{}),redirect:'error' as const,signal:AbortSignal.timeout(30000)}};
}
export async function companyPathCall(action:CompanyPathAction,domain:string,key:string,record:(v:any)=>Promise<void>,fetcher:typeof fetch=fetch,page=1){
  const {url,options}=companyPathRequest(action,domain,key,page);await record({stage:'send_started',route:companyPathRoutes[action],page});
  let response:Response;try{response=await fetcher(url,options);}catch{throw Error('COMPANY_PATH_RESULT_UNKNOWN');}
  const text=await response.text();if(text.length>2000000)throw Error('COMPANY_PATH_RESPONSE_TOO_LARGE');
  const safe=text.replaceAll(key,'[redacted]');await record({stage:'body_received',httpStatus:response.status,rawResponse:safe});
  let raw:any;try{raw=JSON.parse(safe);}catch{throw Error('COMPANY_PATH_JSON_UNKNOWN');}
  if(!response.ok||raw.error)throw Object.assign(Error('COMPANY_PATH_'+(raw.error_code||response.status)),{known:true});
  return raw;
}
export async function companyPathAccount(provider:'hunter'|'prospeo',key:string,record:(v:any)=>Promise<void>,fetcher:typeof fetch=fetch){
  if(!key)throw Object.assign(Error('COMPANY_PATH_KEY_UNAVAILABLE'),{known:true});
  const url=new URL(provider==='hunter'?'https://api.hunter.io/v2/account':'https://api.prospeo.io/account-information');
  if(provider==='hunter')url.searchParams.set('api_key',key);
  await record({stage:'send_started',route:url.pathname});
  const response=await fetcher(url,{headers:provider==='hunter'?{}:{'X-KEY':key},redirect:'error',signal:AbortSignal.timeout(30000)});
  const raw=await response.json();if(!response.ok||raw.error)throw Object.assign(Error('COMPANY_PATH_ACCOUNT_'+response.status),{known:true});
  const d=provider==='hunter'?raw.data:raw.response,credits=d?.requests?.credits||d?.requests?.searches;
  const remaining=provider==='hunter'?(credits?.remaining??credits?.available-credits?.used):d?.remaining_credits;
  const result={provider,plan:provider==='hunter'?d?.plan_name:d?.current_plan,remaining,used:provider==='hunter'?credits?.used:d?.used_credits,checkedAt:new Date().toISOString()};
  await record({stage:'account_received',httpStatus:response.status,account:result});return result;
}
const normal=(v:any)=>String(v||'').normalize('NFKC').trim();
function social(value:any,host:string,personal=false){
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname===host||u.hostname==='www.'+host)&&(!personal||u.pathname.startsWith('/in/'))?u.href:'';}catch{return '';}
}
function matches(company:any,domain:string){return [company?.domain,company?.website,...(company?.other_websites||[])].some(v=>companyDomain(v||'')===domain);}
export function normalizeCompanyPaths(action:CompanyPathAction,company:any,raw:any,at=new Date().toISOString()){
  const domain=companyDomain(company.website),people:any[]=[],channels:any[]=[],held:any[]=[];
  const endpoint=companyPathRoutes[action],provider=action==='hunter_domain'?'Hunter':'Prospeo',sourceUrl=provider==='Hunter'?'https://hunter.io':'https://prospeo.io';
  const ev=(value:any)=>[{sourceUrl,sourceType:'provider_receipt',retrievedAt:at,quote:JSON.stringify({provider,endpoint,requestedCompany:company.name,requestedDomain:domain,record:value})}];
  const contact=(kind:string,value:string,scope:string,evidence:any[])=>({kind,value,scope,evidence,verification:'unverified',ownership:scope==='company'?'company_public':'provider_candidate',provenance:'provider_match',channelEmployer:company.name});
  if(action==='hunter_domain'){
    const d=raw.data||{};if(companyDomain(d.domain||'')!==domain)return {people,channels,held:[{reason:'returned_domain_mismatch',returnedDomain:d.domain||null}]};
    for(const p of (d.emails||[]).slice(0,2)){
      const name=normal([p.first_name,p.last_name].filter(Boolean).join(' ')),evidence=ev(p),contacts:any[]=[];
      const email=normal(p.value).toLowerCase();
      if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&companyDomain(email.split('@')[1])===domain){
        const ch=contact('email',email,p.type==='personal'&&name?'person':'company',evidence);if(ch.scope==='person')contacts.push(ch);else channels.push(ch);
      }
      const linkedin=social(p.linkedin||p.linkedin_url,'linkedin.com',true);if(linkedin)contacts.push(contact('social',linkedin,'person',evidence));
      if(/^[A-Za-z0-9_]{1,15}$/.test(p.twitter||''))contacts.push(contact('social','https://x.com/'+p.twitter,'person',evidence));
      if(name)people.push({name,title:normal(p.position_raw||p.position),profileUrl:linkedin,sourcePersonId:'hunter:'+domain+':'+name.toLowerCase(),relationship:'unknown',employerClaim:company.name,employerVerified:false,evidence,contacts,
        detailUnknowns:['供应商企业关联及公开渠道候选；现任、归属及技术有效性尚待核实。']});
    }
  }else if(action==='prospeo_company'){
    const c=raw.company||{};if(!matches(c,domain))return {people,channels,held:[{reason:'returned_domain_mismatch',returnedCompany:c}]};
    const evidence=ev(c);
    for(const [field,host] of [['linkedin_url','linkedin.com'],['twitter_url','x.com'],['facebook_url','facebook.com'],['instagram_url','instagram.com'],['youtube_url','youtube.com']]){
      const value=social(c[field],host);if(value)channels.push(contact('social',value,'company',evidence));
    }
    const phone=c.phone_hq?.phone_hq_international||c.phone_hq?.phone_hq;if(/^\+?[0-9 ()-]{6,30}$/.test(phone||''))channels.push(contact('phone',phone,'company',evidence));
  }else for(const item of (raw.results||[]).slice(0,25)){
    const p=item.person||{},c=item.company||{},name=normal(p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' '));
    if(!name||!matches(c,domain)){held.push({reason:'person_company_unmatched',person:p,company:c});continue;}
    const evidence=ev({person:p,company:c}),url=social(p.linkedin_url,'linkedin.com',true);
    const careerHistory=(p.job_history||[]).map((j:any)=>({employer:normal(j.company_name),title:normal(j.title),status:j.current?'current_claim':'former_claim',
      period:[j.start_year?[j.start_year,j.start_month].filter(Boolean).join('-'):'日期未知',j.current?'至今（供应商声明）':j.end_year?[j.end_year,j.end_month].filter(Boolean).join('-'):'日期未知'].join(' — '),evidence}));
    people.push({name,title:normal(p.current_job_title||p.headline),profileUrl:url,sourcePersonId:'prospeo:'+(p.person_id||url||domain+':'+name.toLowerCase()),relationship:'unknown',employerClaim:normal(c.name)||company.name,employerVerified:false,evidence,careerHistory,
      contacts:url?[contact('social',url,'person',evidence)]:[],detailUnknowns:['供应商人物及任职记录，身份、归属与时效待核实；未揭示手机或邮箱。']});
  }
  return {people,channels,held};
}
