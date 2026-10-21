import {scopeVersion} from './qualification.mjs';
import {exclusiveDomain} from './company-identity.mjs';
const normal=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function supportedBuyer(data,c){
  const q=c.qualification,v=scopeVersion(data.project),e=data.sourcePipeline?.entities?.find(e=>e.id===c.entityId);
  if(c.sourceOnly||!c.officialOwnership?.verified||!e?.ownership?.verified||!q||q.status!=='qualified'||
    q.scopeKey!==v.scopeKey||q.analysisVersion!==v.analysisVersion||!q.identityVerified||!q.marketVerified||
    !q.buyerVerified||q.criticalUnknowns?.length||q.evidence?.length!==4||!q.reasons?.length)return false;
  const pages=(e.websitePages||[]).filter(p=>p.content&&Date.parse(p.retrievedAt)+86400000>Date.now());
  return pages.some(p=>p.url===c.officialOwnership.url&&p.content.includes(c.officialOwnership.quote))&&
    q.evidence.every(ev=>ev.sourceId&&ev.quote?.length>=8&&pages.some(p=>p.url===ev.url&&p.content.includes(ev.quote)));
}
export function targetMilestone(rows,target=3){
  if(new Set(rows.map(r=>r.tenant_id).filter(Boolean)).size>1)throw Error('MILESTONE_TENANT_MISMATCH');
  const items=[],identities=new Map();let candidateRecords=0;
  for(const row of rows){
    const d=row.data;candidateRecords+=(d.sourcePipeline?.entities||[]).filter(e=>e.role==='potential_buyer'&&!e.locatorOnly).length;
    for(const c of d.companies.filter(c=>supportedBuyer(d,c))){
      const keys=c.registryVerified&&c.registryId?['registry:'+c.registryId]:[
        ...(exclusiveDomain(c)?['site:'+exclusiveDomain(c)]:[]),
        'name:'+normal(c.name),...(c.verifiedAliases||[]).map(a=>'name:'+normal(a))];
      let item=keys.map(k=>identities.get(k)).find(Boolean);
      if(!item){item={identity:keys[0],name:c.name,website:c.website,campaignIds:[],markets:[],observations:[]};items.push(item);}
      for(const k of keys)identities.set(k,item);
      if(!item.campaignIds.includes(row.id))item.campaignIds.push(row.id);
      if(!item.markets.includes(d.project.country))item.markets.push(d.project.country);
      item.observations.push({campaignId:row.id,companyId:c.id,market:d.project.country,ownership:c.officialOwnership,evidence:c.qualification.evidence});
    }
  }
  return {target,qualified:items.length,remaining:Math.max(0,target-items.length),reached:items.length>=target,candidateRecords,items};
}
