import {matchesEntityText} from '../../scripts/research/locator-plan.mjs';
import {referenceSite} from '../../scripts/research/source-site-pointer.mjs';
export function retainLocatorReferences(data:any){
  for(const e of data.sourcePipeline?.entities||[]){
    const queries=new Set([...(e.resolutionHistory||[]),e.resolution].filter((r:any)=>r?.status==='done').map((r:any)=>r.query));
    const existing=e.locatorReferences ||= [];
    for(const q of data.requests.filter((q:any)=>q.service==='langsearch'&&q.status==='done'&&queries.has(q.requestBody.query)))for(const h of q.response?.data?.webPages?.value||[]){
      const text=String(h.name||'')+' '+String(h.text||h.snippet||'');
      if(!referenceSite(h.url)||!matchesEntityText(e,text)||existing.some((v:any)=>v.url.replace(/\/$/,'')===String(h.url).replace(/\/$/,'')))continue;
      existing.push({url:h.url,title:h.name,snippet:h.text||h.snippet,requestId:q.id,kind:'reference',observedAt:q.startedAt});
    }
  }
}
