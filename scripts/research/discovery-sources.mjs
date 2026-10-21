import {hash} from './core.mjs';
import {httpUrl} from './schema.mjs';
export function rememberSource(data,hit,query,provider,requestId){
  let url;try{url=httpUrl(hit.url);}catch{return null;}
  const title=String(hit.title||hit.name||''),text=String(hit.snippet||hit.text||''),contentHash=hash(JSON.stringify([title,text]));
  const pages=data.sourcePages ||= [],id='S-'+hash(url).slice(0,24);
  let page=pages.find(p=>p.id===id);
  if(!page){page={id,url,title,text,contentHash,versions:[],queries:[],requestIds:[],provider,status:'待识别企业'};pages.push(page);}
  if(page.contentHash!==contentHash&&!page.versions.some(v=>v.contentHash===contentHash)){page.versions.push({title:page.title,text:page.text,contentHash:page.contentHash});Object.assign(page,{title,text,contentHash,status:'资料已更新，待重新识别'});}
  if(query&&!page.queries.includes(query))page.queries.push(query);
  if(requestId&&!page.requestIds.includes(requestId))page.requestIds.push(requestId);
  return page;
}
export function savedSources(data){
  const queries=new Set((data.sourcePipeline?.entities||[]).map(e=>e.resolution?.query).filter(Boolean));
  const locatorIds=new Set((data.requests||[]).filter(r=>r.purpose==='official_resolution'||queries.has(r.requestBody?.query)).map(r=>r.id));
  const copy={sourcePages:structuredClone((data.sourcePages||[]).filter(p=>!p.requestIds?.length||p.requestIds.some(id=>!locatorIds.has(id))))};
  for(const r of data.requests||[]){
    if(r.status!=='done'||!['langsearch','bocha','search'].includes(r.service)||locatorIds.has(r.id))continue;
    const hits=r.response?.data?.webPages?.value||r.response?.results||[];
    for(const hit of hits)rememberSource(copy,{url:hit.url,title:hit.name||hit.title,snippet:hit.text||hit.summary||hit.snippet||hit.content},r.requestBody?.query,r.service,r.id);
  }
  for(const c of data.companies||[])for(const e of c.discovery||[])if(!copy.sourcePages.some(p=>p.url===e.url))rememberSource(copy,{url:e.url,title:e.title,snippet:e.summary},e.query,e.provider);
  for(const e of data.discoveryReferences||[])if(!copy.sourcePages.some(p=>p.url===e.url))rememberSource(copy,{url:e.url,title:e.title,snippet:e.summary},e.query,e.provider);
  return copy.sourcePages;
}
export function prepareSources(data){
  const sources=savedSources(data);
  data.locatorPages ||= [];
  for(const p of data.sourcePages||[])if(!sources.some(s=>s.id===p.id)&&!data.locatorPages.some(s=>s.id===p.id))data.locatorPages.push(structuredClone(p));
  data.sourcePages=sources;
  data.sourcePipeline ||= {version:1,extractions:[],entities:[],startedAt:new Date().toISOString()};
  for(const e of data.sourcePipeline.entities||[])if(e.evidence?.length){
    e.locatorOnly=e.evidence.every(c=>data.locatorPages.some(p=>p.id===c.sourceId))&&!e.evidence.some(c=>sources.some(p=>p.id===c.sourceId));
    if(e.locatorOnly)e.status='官网定位响应附带提及，保留来源；不进入新买家识别';
  }
  data.project.entityDiscovery=true;
  for(const c of data.companies||[])if(!c.apolloId&&!c.entityId&&!c.qualification?.identityVerified){
    c.sourceOnly=true;c.sourceReviewReason='历史搜索来源，企业归属尚未核实；原资料保留。';
  }
  return data.sourcePipeline;
}
export function pipelineMetrics(data){
  const pages=savedSources(data),entities=(data.sourcePipeline?.entities||[]).filter(e=>!e.locatorOnly&&['company','brand','organization'].includes(e.entityType));
  return {sourcePages:pages.length,legacySources:data.companies.filter(c=>c.sourceOnly).length,
    entityCount:entities.length,unresolved:entities.filter(e=>e.role==='potential_buyer'&&!e.website).length,
    officialCandidates:entities.filter(e=>e.website).length,
    ownershipVerified:entities.filter(e=>e.ownership?.verified).length,
    resolutionPause:data.sourcePipeline?.resolutionPause||null,budget:data.sourcePipeline?.budget||null,
    sourcesProcessed:pages.filter(p=>p.status==='企业识别完成').length,
    suggestedQueries:data.sourcePipeline?.suggestedQueries||[]};
}
