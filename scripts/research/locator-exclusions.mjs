import {host} from './core.mjs';
import {exclusionDomains} from './search-capabilities.mjs';
import {matchesEntityText} from './locator-plan.mjs';
const portals=['wikipedia.org','facebook.com','instagram.com','linkedin.com','youtube.com','reddit.com','x.com'];
const domain=url=>{try{return host(url);}catch{return null;}};
export function locatorExclusions(data,entity,purpose,related=[]){
  if(purpose==='discovery')return exclusionDomains('langsearch',[...related,...(data.project.excludedDomains||[]),
    ...data.companies.filter(c=>!c.sourceOnly).map(c=>domain(c.website)).filter(Boolean)]);
  const irrelevant=(data.sourcePages||[]).filter(p=>p.kind==='unrelated'&&!matchesEntityText(entity,(p.title||'')+' '+(p.text||'')))
    .map(p=>domain(p.url)).filter(Boolean);
  // Reference publishers remain usable for locating declared website links; they are not old buyers.
  const exclusions=[...irrelevant,...(purpose==='official_resolution'?portals:[])];
  const keep=(entity.officialCandidates||[]).map(c=>domain(c.url)).concat(domain(entity.website)).filter(Boolean);
  return exclusionDomains('langsearch',exclusions.filter(d=>!keep.some(k=>k===d||k.endsWith('.'+d))));
}
export function locatorInclusions(entity,purpose){
  return purpose==='local_operator'&&entity.ownership?.verified&&domain(entity.ownership.url)?[domain(entity.ownership.url)]:[];
}
