import {host} from './core.mjs';
import {httpUrl} from './schema.mjs';
import {referenceSite} from './source-site-pointer.mjs';
import {matchesEntityText} from './locator-plan.mjs';
const normalize=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const shared=['wikipedia.org','facebook.com','instagram.com','linkedin.com','youtube.com','reddit.com','x.com'];
export function classifySite(entity,hit,blocked=[]){
  let url,domain;
  try{url=httpUrl(hit.url);domain=host(url);}catch{return {accepted:false,reason:'链接无效'};}
  const path=new URL(url).pathname;
  if(referenceSite(url))return {url,domain,accepted:false,reason:'第三方资料或发布平台，先查明示官网链接，不能直接当企业官网'};
  if([...shared,...blocked].some(d=>domain===d||domain.endsWith('.'+d)))return {url,domain,accepted:false,reason:'来源平台或资料网站，不能直接作为企业官网'};
  if(/\.pdf$/i.test(path)||/\/(?:donor-lookup|obituaries)(?:\/|$)/i.test(path)||
    ((domain==='blogger.com'||domain.endsWith('.blogger.com')))||
    (domain.endsWith('.blogspot.com')&&/\/search(?:\/|$)/i.test(path)))return {url,domain,accepted:false,reason:'档案、捐赠记录、聚合页或非HTML资料，不是官网候选'};
  const name=normalize(entity.name);
  if(!name)return {url,domain,accepted:false,reason:'企业名称不完整，无法判断链接归属'};
  const named=matchesEntityText(entity,hit.title+' '+(hit.text||hit.snippet||''));
  if(!hit.sourceId&&!named)return {url,domain,accepted:false,reason:'标题与文字未出现该企业名称'};
  return {url,domain,accepted:true,reason:hit.sourceId?'已保存的明示或观察到的链接，归属待核实':'文字提及企业，官网归属仍需核实'};
}
export function resolutionAudit(entity,hits,blocked=[]){
  const items=hits.map(h=>({...h,...classifySite(entity,h,blocked)}));
  return {returned:hits.length,named:items.filter(h=>matchesEntityText(entity,h.title+' '+(h.text||h.snippet||''))).length,
    candidates:items.filter(h=>h.accepted).length,items,reason:items.some(h=>h.accepted)?'有官网候选，归属尚未确认':'结果未支持官网定位；保留资料并停止同类查询'};
}
export function diagnoseRequest(request,entity){
  const query=request.requestBody?.query,echo=request.response?.data?.queryContext?.originalQuery;
  const hits=(request.response?.data?.webPages?.value||[]).map(h=>({url:h.url,title:h.name,text:h.text||h.snippet||''}));
  return {requestId:request.id,query,echo,queryEchoMatched:echo===query,httpStatus:request.httpStatus,
    logId:request.response?.log_id||null,usage:request.response?.usage||null,...resolutionAudit(entity,hits)};
}
export function resolutionPause(data,plan=null){
  const resolutions=(data.sourcePipeline?.entities||[]).flatMap(e=>[...(e.resolutionHistory||[]),e.resolution]).filter(r=>r?.status==='done'&&!r.fromSavedSource);
  const relevant=plan?resolutions.filter(r=>(r.provider||'langsearch')===plan.provider&&r.family===plan.family):resolutions;
  const last=relevant.sort((a,b)=>Date.parse(b.completedAt)-Date.parse(a.completedAt)).slice(0,2);
  return last.length===2&&last.every(r=>r.audit?.candidates===0)?'最近两次官网定位均无可用候选，请先检查已保存结果及搜索来源；未发出下一次查询。':null;
}
