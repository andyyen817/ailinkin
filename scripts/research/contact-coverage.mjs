import {contactSourceAdmission,differentEmployerNames} from './contact-source-relevance.mjs';
export function deepContactCoverage(data,batch){
  return (batch.companyIds||[]).flatMap(companyId=>(batch.platforms||[]).map(platform=>{
    const company=(data.companies||[]).find(c=>c.id===companyId),units=(batch.units||[]).filter(u=>u.companyId===companyId&&u.platform===platform);
    const runs=(data.contactResearchRuns||[]).filter(r=>units.some(u=>u.runId===r.id));
    const pages=runs.filter(r=>r.state==='done'&&!r.fallbackUsed&&r.page?.state==='read'&&r.page?.method!=='company_source_pool');
    const unknown=units.filter(u=>u.state==='unknown').length,pending=units.filter(u=>['needs_search','pending','running'].includes(u.state)).length;
    const blocked=units.filter(u=>['blocked','cached_fallback'].includes(u.state)).length,outside=units.filter(u=>u.state==='outside_scope').length;
    const queries=units.filter(u=>u.searchResults!==undefined).length,snippets=units.reduce((n,u)=>n+(u.searchEvidenceIds?.length||0),0);
    const admissions=(data.contactSearchEvidence||[]).filter(s=>s.companyId===companyId&&s.platform===platform)
      .map(s=>contactSourceAdmission(company||{name:s.companyName},s,{differentEmployers:differentEmployerNames(data,company||{id:companyId})}));
    const state=unknown?'unknown':pending?'pending':blocked?'blocked':outside?'scope_limited':pages.length?'read_partial':queries?'search_only':'not_started';
    const notice=unknown?'结果未知，停止新请求':pending?'仍有搜索或页面等待处理':blocked?'保留受限入口，已保存材料可复用':outside?'尚有本轮范围或额度之外的页面':
      pages.length?'已读有限公开页面；当前任职及采购权按原文核实':queries?'仅取得索引结果，尚不能代表社媒正文':'尚未研究此来源';
    return {companyId,companyName:company?.name||companyId,platform,state,notice,queries,snippets,pagesRead:pages.length,
      pending,blocked,outside,unknown,observedPages:units.filter(u=>u.url).length,collectionComplete:false,
      admittedSources:admissions.filter(a=>a.state==='admitted').length,heldSources:admissions.filter(a=>a.state==='held').length,rejectedSources:admissions.filter(a=>a.state==='rejected').length,
      sources:units.filter(u=>u.url).map(u=>({url:u.url,state:u.state,reason:u.reason,depth:u.depth||0,identity:runs.find(r=>r.id===u.runId)?.identity?.status||'unconfirmed'}))};
  }));
}
