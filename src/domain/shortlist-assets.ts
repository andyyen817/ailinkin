import {entityContextKey} from '../../scripts/research/discovery-entities.mjs';
export function knownShortlistEntries(data:any){
  return (data.companies||[]).filter((c:any)=>c.entityId&&!c.sourceOnly&&c.website&&c.officialOwnership?.verified&&c.officialOwnership?.result?.qualification?.buyer?.matched)
    .map((c:any)=>({id:c.entityId,name:c.name,website:c.website,priorCheckedAt:c.officialOwnership.checkedAt,priorSource:c.officialOwnership.url,priorQuote:c.officialOwnership.quote}));
}
export function seedShortlistEntries(data:any){
  const entries=knownShortlistEntries(data);if(!entries.length)return;
  data.sourcePipeline ||= {version:1,extractions:[],entities:[],startedAt:new Date().toISOString()};
  for(const entry of entries){
    let e=data.sourcePipeline.entities.find((e:any)=>e.id===entry.id);
    if(e?.fromKnownAsset)continue;
    if(!e){e={id:entry.id,name:entry.name,entityType:'company',evidence:[],aliases:[],officialCandidates:[]};data.sourcePipeline.entities.push(e);}
    e.priorRole=e.role;e.role='potential_buyer';e.contextHash=entityContextKey(data.project);e.locatorOnly=false;
    e.fromKnownAsset={source:entry.priorSource,quote:entry.priorQuote,checkedAt:entry.priorCheckedAt};
    e.evidence ||= [];e.evidence.push({url:entry.priorSource,quote:entry.priorQuote,kind:'historical_official_entry'});
    e.website=entry.website;e.status='复用历史官网入口；当前市场与适配重新核实';
  }
}
export function unknownShortlistBlockers(data:any,scope:any){
  return data.requests.filter((r:any)=>['pending','unknown'].includes(r.status)&&!(r.status==='unknown'&&r.service==='langsearch'&&r.httpStatus===502&&r.reservedCost===0&&scope.continuedUnknownFreeRequestIds?.includes(r.id)));
}
