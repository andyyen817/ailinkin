import {scopeVersion} from './qualification.mjs';
import {exclusiveDomain} from './company-identity.mjs';
import {currentEntities} from './buyer-pipeline.mjs';
import {entityContextKey} from './discovery-entities.mjs';
export function qualityMetrics(data){
  const {scopeKey,analysisVersion}=scopeVersion(data.project),unique=new Map();
  for(const c of data.companies){
    if(c.sourceOnly)continue;
    const key=c.assetId||c.apolloId||exclusiveDomain(c)||c.id;
    if(!unique.has(key))unique.set(key,c);
  }
  for(const e of currentEntities(data))if(![...unique.values()].some(c=>c.entityId===e.id))unique.set('entity:'+e.id,{id:e.id,entityId:e.id});
  for(const e of data.sourcePipeline?.rejectedEntities||[])if(e.contextHash===entityContextKey(data.project)&&e.role==='potential_buyer'&&!currentEntities(data).some(c=>c.name===e.name))unique.set('rejected:'+e.name,{id:'rejected:'+e.name});
  let qualified=0,unfit=0,reviewed=0,contactable=0,emailReady=0;
  for(const c of unique.values()){
    const q=c.qualification,current=q&&q.scopeKey===scopeKey&&q.analysisVersion===analysisVersion;
    const usable=current&&q.reasons?.length&&q.evidence?.every(e=>e.sourceId&&e.url&&e.quote);
    const valid=usable&&q.status==='qualified'&&q.identityVerified&&q.marketVerified&&q.buyerVerified&&q.evidence.length>0&&!q.criticalUnknowns?.length;
    if(valid)qualified++;
    if(usable&&q.status==='unfit')unfit++;
    if(valid||(usable&&q.status==='unfit'))reviewed++;
    const contacts=data.contacts.filter(p=>p.companyId===c.id&&!p.suppressed&&p.employerVerified===true);
    if(valid&&contacts.some(p=>p.source&&(p.email||p.phone)))contactable++;
    if(valid&&!c.doNotContact&&contacts.some(p=>p.email&&p.emailVerification?.status==='valid'&&
      Date.parse(p.emailVerification.expiresAt)>Date.now()&&p.emailVerification.source))emailReady++;
  }
  const reservedUsd=data.requests.reduce((sum,r)=>sum+(r.reservedCost||0),0);
  const known=data.requests.filter(r=>Number.isFinite(r.actualCostUsd));
  return {candidates:unique.size,qualified,unfit,pending:unique.size-qualified-unfit,contactable,emailReady,
    reviewed,coverage:unique.size?reviewed/unique.size:0,qualificationRate:unique.size?qualified/unique.size:0,
    rawResults:data.batches.reduce((sum,b)=>sum+(b.count||0),0),duplicates:data.batches.reduce((sum,b)=>sum+(b.duplicates||0),0),
    reusedCandidates:[...unique.values()].filter(c=>c.reusedFromCampaigns?.length).length,
    cacheHits:data.cacheHits||0,excludedDomains:(data.project.excludedDomains||data.project.buyerGroup?.excludedDomains||[]).length,
    reservedUsd,actualUsd:known.length===data.requests.length?known.reduce((s,r)=>s+r.actualCostUsd,0):null,
    reservedUsdPerQualified:qualified?reservedUsd/qualified:null,remaining:data.project.discoveryPolicy?.mode==='coverage'?null:Math.max(0,data.project.target-qualified),
    expectedTarget:data.project.discoveryPolicy?.expectedTarget??data.project.target,discoveryCoverage:data.discoveryCoverage||null};
}
