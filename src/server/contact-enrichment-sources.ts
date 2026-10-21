import 'server-only';
import {publicGet} from '../../scripts/research/public-page-client.mjs';
import {readSocialPage} from '../../scripts/research/social-page-reader.mjs';
import {htmlContactText} from '../../scripts/research/contact-text-extractor.mjs';
import {readTracePage} from './contact-trace-reader';
const qualificationUrl='https://langsearch.com/pricing';
export function publicFreeQualification(html:string){
  const text=htmlContactText(html,qualificationUrl).text;
  const free=/One Free Plan/i.test(text)&&/No per-request charges/i.test(text)&&/\$0\s*(?:USD)?/i.test(text);
  return {free,plan:free?'Free Plan':'未知',remaining:null,checkedAt:new Date().toISOString(),sourceUrl:qualificationUrl,
    quote:text.slice(Math.max(0,text.indexOf('Every feature')),Math.max(0,text.indexOf('Every feature'))+4500),notice:free?'官方单一免费方案已核实；每日剩余令牌未提供，遇限流立即停用，不购买。':'未确认免费，停用公开搜索。'};
}
export async function executeEnrichmentPublic(op:any,batch:any,record:any,fetcher:typeof fetch=fetch,get:any=publicGet){
  if(batch.traceMethod==='trace_v2'&&op.kind==='public_page')return readTracePage(op,batch,record,get);
  const before=async({url}:{url:string})=>{
    const count=batch.receipts.flatMap((r:any)=>r.stages||[]).filter((s:any)=>s.stage==='public_network_started').length;
    if(count>=batch.limits.network)throw Object.assign(Error('PUBLIC_NETWORK_CAP_REACHED'),{known:true});
    await record({stage:'public_network_started',url,at:new Date().toISOString()});
  };
  if(op.kind==='public_qualification'){
    const raw=await get(qualificationUrl,{beforeRequest:before,maxRequests:3,timeoutMs:10000,limit:512000});
    await record({stage:'body_received',httpStatus:raw.status,rawResponse:raw.text.slice(0,128000)});
    return raw.status===200?publicFreeQualification(raw.text):{free:false,reason:'免费方案页面无法读取'};
  }
  if(op.kind==='public_search'){
    const key=process.env.LANGSEARCH_API_KEY;if(!key||!batch.publicQualification?.free)throw Object.assign(Error('PUBLIC_FREE_SOURCE_UNAVAILABLE'),{known:true});
    const requestBody={query:op.query,count:10,freshness:'noLimit',contents:{text:{maxCharacters:2500}}};
    await record({stage:'send_started',route:'/v1/web-search',requestBody});
    await before({url:'https://api.langsearch.com/v1/web-search'});
    const response=await fetcher('https://api.langsearch.com/v1/web-search',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(requestBody),redirect:'error',signal:AbortSignal.timeout(25000)});
    const text=await response.text();await record({stage:'body_received',httpStatus:response.status,rawResponse:text.replaceAll(key,'[redacted]').slice(0,160000)});
    let raw:any;try{raw=JSON.parse(text);}catch{throw Object.assign(Error('PUBLIC_SEARCH_BAD_RESPONSE'),{known:true});}
    if(!response.ok||String(raw.code)!=='200'||!Array.isArray(raw.data?.webPages?.value))throw Object.assign(Error('PUBLIC_SEARCH_HTTP_'+response.status),{known:true,status:response.status});
    if(raw.data.queryContext?.originalQuery&&raw.data.queryContext.originalQuery!==op.query)throw Object.assign(Error('PUBLIC_SEARCH_QUERY_MISMATCH'),{known:true});
    return {usage:raw.usage||null,results:raw.data.webPages.value.slice(0,10).map((r:any)=>({url:r.url,title:r.name||'',snippet:r.text||r.snippet||''})),sourceType:'search_index_text',priceUsd:0};
  }
  if(op.kind==='public_page'){
    let html='';
    const capture=async(url:string,options:any)=>{
      if(new URL(url).pathname.endsWith('/robots.txt')){
        const prior=batch.receipts.flatMap((r:any)=>r.stages||[]).findLast((s:any)=>s.stage==='public_body_received'&&s.url===url);
        if(prior){await record({stage:'public_robots_reused',url});return {status:prior.httpStatus,text:prior.rawResponse,url,headers:{},networkRequests:0};}
        if(batch.receipts.flatMap((r:any)=>r.stages||[]).some((s:any)=>s.stage==='public_network_started'&&s.url===url))throw Error('PUBLIC_ROBOTS_PREVIOUS_UNKNOWN_NO_RETRY');
      }
      const raw=await get(url,{...options,beforeRequest:before,maxRequests:Math.min(options.maxRequests||3,3),timeoutMs:10000,limit:512000});
      if(!new URL(url).pathname.endsWith('/robots.txt'))html=raw.text;
      await record({stage:'public_body_received',url,httpStatus:raw.status,rawResponse:raw.text.slice(0,96000)});return raw;
    };
    try{
      const page=await readSocialPage(op.url,{companyId:op.companyId,browser:false,maxImages:0,maxNetworkRequests:4,beforeRequest:before},capture);
      const clean=html.replace(/<(footer|nav|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' '),parsed=htmlContactText(clean,page.url||op.url);
      const heading=htmlContactText((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||'',op.url).text;
      return {...page,heading,links:parsed.links,personText:parsed.text.slice(0,64000),readAt:new Date().toISOString()};
    }catch(e){return {state:'restricted',url:op.url,blocks:[],links:[],reason:String((e as Error).message).slice(0,300),readAt:new Date().toISOString()};}
  }
  throw Object.assign(Error('PUBLIC_ACTION_DENIED'),{known:true});
}
