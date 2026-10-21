import {host,upsertCompany} from './core.mjs';
import {isMainland,mainlandCandidate} from './mainland-profile.mjs';
import {findCompany} from './company-identity.mjs';
import {rememberSource} from './discovery-sources.mjs';
const referenceSites=['wikipedia.org','facebook.com','instagram.com','x.com','twitter.com','tiktok.com','reddit.com','linkedin.com','xiaohongshu.com','alibaba.com','made-in-china.com','europages.com','kompass.com','youtube.com','amazon.com'];
export function webCandidate(data,hit,query,provider){
  if(data.project.entityDiscovery){
    const page=rememberSource(data,hit,query,provider);
    return {excluded:true,reason:page?'来源页已保存，等待识别企业':'链接无效',url:hit.url,sourceId:page?.id};
  }
  if(isMainland(data.project)&&!data.project.buyerGroup)return mainlandCandidate(data,hit,query,provider);
  let domain;try{domain=host(hit.url);}catch{return {excluded:true,reason:'链接无效',url:hit.url};}
  if(referenceSites.some(d=>domain===d||domain.endsWith('.'+d))){
    data.discoveryReferences ||= [];
    if(!data.discoveryReferences.some(r=>r.url===hit.url&&r.query===query))data.discoveryReferences.push({
      provider,query,url:hit.url,title:hit.title,summary:hit.snippet||'',status:'待解析企业入口',retrievedAt:new Date().toISOString()});
    return {excluded:true,reason:'资料平台或目录，尚未确认企业官网',url:hit.url};
  }
  if(!hit.title?.trim()&&!hit.siteName?.trim())return {excluded:true,reason:'缺少标题及站点名称',url:hit.url};
  const existing=findCompany(data.companies,{website:hit.url});
  const result=existing?{company:existing,added:false}:upsertCompany(data,{
    name:hit.siteName?.trim()||domain,country:data.project.buyerGroup?'未知':data.project.country,city:data.project.buyerGroup?'':data.project.city,
    website:new URL(hit.url).origin,source:hit.url,
  });
  const c=result.company;c.discovery ||= [];c.targetMarket=data.project.country;
  if(!c.discovery.some(e=>e.url===hit.url&&e.query===query))c.discovery.push({
    provider,query,url:hit.url,title:hit.title,summary:hit.snippet?.slice(0,6000)||'',publishedAt:hit.date,marketSource:'query_only',
    retrievedAt:new Date().toISOString(),
  });
  if(result.added)c.status='待核实';
  return result;
}
export function discoveryQuery(keyword,project){
  const structured=project.buyerGroup?.searchSpecs?.find(s=>s.query===keyword);
  if(structured)return structured.query;
  const country=/^(瑞典|Sweden|Sverige)$/i.test(project.country)?(/mässing|grossist|beslag|inredning/i.test(keyword)?'Sverige':'Sweden'):project.country;
  return [keyword,project.city,country].filter(Boolean).join(' ');
}
