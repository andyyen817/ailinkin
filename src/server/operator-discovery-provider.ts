import 'server-only';
export function discoveryRequest(op:any,batch:any){
  if(op.kind==='location')return {route:'/search-suggestions',body:{location_search:batch.direction.country}};
  if(op.kind!=='company_search'||!batch.location)throw Error('OPERATOR_LOCATION_REQUIRED');
  return {route:'/search-company',body:{page:1,filters:{
    company_location_search:{include:[batch.location]},
    company_keywords:{include:batch.direction.keywords,include_all:false,search_everywhere:true},
  }}};
}
export async function operatorDiscoveryCall(op:any,batch:any,key:string,record:any,fetcher:typeof fetch=fetch){
  if(!key)throw Object.assign(Error('FREE_PROVIDER_KEY_UNAVAILABLE'),{known:true});
  const {route,body}=discoveryRequest(op,batch);
  await record({stage:'send_started',route,requestBody:body});
  const response=await fetcher('https://api.prospeo.io'+route,{method:'POST',headers:{'X-KEY':key,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
  const text=await response.text();if(text.length>2000000)throw Error('COMPANY_PATH_RESPONSE_TOO_LARGE');
  const safe=text.replaceAll(key,'[redacted]'),rateHeaders=Object.fromEntries([...response.headers].filter(([k])=>/rate|daily|retry/i.test(k)));
  await record({stage:'body_received',httpStatus:response.status,rawResponse:safe,rateHeaders});
  const raw=JSON.parse(safe);
  if((!response.ok||raw.error)&&!(op.kind==='company_search'&&response.status===400&&raw.error_code==='NO_RESULTS'))throw Object.assign(Error('COMPANY_DISCOVERY_'+(raw.error_code||response.status)),{known:true});
  return raw;
}
export function canonicalCountry(raw:any,requested:string){
  const countries=(raw.location_suggestions||[]).filter((s:any)=>s.type==='COUNTRY'&&typeof s.name==='string');
  const exact=countries.find((s:any)=>s.name.toLowerCase()===requested.toLowerCase());
  if(exact)return exact.name;
  if(countries.length===1)return countries[0].name;
  throw Error('OPERATOR_COUNTRY_AMBIGUOUS');
}
