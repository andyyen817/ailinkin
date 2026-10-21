import {prepareSources,savedSources,rememberSource} from './discovery-sources.mjs';
import {entityContextKey} from './discovery-entities.mjs';
import {applyOwnership} from './buyer-resolution.mjs';
export function inheritSourceHistory(data,histories){
  if(!histories.length)return;
  const context=entityContextKey(data.project);prepareSources(data);
  for(const history of histories){
    if(history.project.tenantId!==data.project.tenantId)throw Error('SOURCE_HISTORY_TENANT_MISMATCH');
    const old={project:history.project,sourcePages:history.sourcePages||[],companies:history.companies||[],requests:[],discoveryReferences:history.discoveryReferences||[]};
    const matching=entityContextKey(history.project)===context;
    for(const p of savedSources(old)){
      const existing=data.sourcePages.find(s=>s.id===p.id);
      if(!existing){data.sourcePages.push(structuredClone(p));}
      else if(existing.contentHash!==p.contentHash)rememberSource(data,p,p.queries[0],p.provider);
      const page=data.sourcePages.find(s=>s.id===p.id);page.reusedFromCampaigns=[...new Set([...(page.reusedFromCampaigns||[]),history.id])];
      if(!matching&&page.extractionContext!==context){delete page.extractionContext;delete page.extractedContentHash;page.status='当前画像待重新识别';}
    }
    if(!matching||!history.sourcePipeline)continue;
    for(const x of history.sourcePipeline.extractions||[])if(!data.sourcePipeline.extractions.some(e=>e.key===x.key))data.sourcePipeline.extractions.push({...structuredClone(x),reusedFromCampaign:history.id});
    for(const oldEntity of history.sourcePipeline.entities||[]){
      if(oldEntity.contextHash!==context||data.sourcePipeline.entities.some(e=>e.id===oldEntity.id))continue;
      const entity=structuredClone(oldEntity);entity.reusedFromCampaign=history.id;data.sourcePipeline.entities.push(entity);
      const page=entity.websitePages?.at(-1);
      if(entity.ownership?.verified&&entity.verification?.result&&page&&Date.parse(page.retrievedAt)+86400000>Date.now()){
        const company=applyOwnership(data,entity,page,entity.verification.result);if(company)company.reusedFromCampaigns=[history.id];
      }
    }
  }
}
