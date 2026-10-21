import {hash} from './core.mjs';
import {prepareSources} from './discovery-sources.mjs';
import {applyEntities,checkedEntityBatch,entityMessages,extractionKey,entityContextKey,entityContext} from './discovery-entities.mjs';
import {applyOwnership,locateEntity,ownershipMessages,reviewSavedResolutions} from './buyer-resolution.mjs';
import {resolutionQueries} from './discovery-entities.mjs';
import {locatorPlanIds,selectLocatorPlan} from './locator-plan.mjs';
import {collectBuyerPages,verifyBuyerBatch,pendingPageReads,pendingBuyerChecks} from './buyer-verification.mjs';
export const buyerStages=['prepare','extract','resolve','verify','read-sites','verify-batch','review-saved'];
export function currentEntities(data){
  const market=String(entityContext(data.project).marketTerm||'').toLowerCase();
  const relevance=e=>(e.officialCandidates?.length?6:0)+(e.evidence||[]).reduce((n,c)=>{
    const p=data.sourcePages?.find(p=>p.id===c.sourceId);
    return n+(String(c.quote||'').toLowerCase().includes(market)?3:0)+(String(p?.title+' '+p?.text).toLowerCase().includes(market)?1:0);
  },0);
  return (data.sourcePipeline?.entities||[]).filter(e=>e.role==='potential_buyer'&&!e.locatorOnly&&e.contextHash===entityContextKey(data.project)).sort((a,b)=>relevance(b)-relevance(a));
}
export function nextBuyerStage(data,sourceIds){
  if(!data.sourcePipeline)return 'prepare';
  const context=entityContextKey(data.project);
  if(data.sourcePages.some(p=>(!sourceIds||sourceIds.includes(p.id))&&(p.extractionContext!==context||p.extractedContentHash!==p.contentHash)))return 'extract';
  const entities=currentEntities(data),unresolved=entities.some(e=>!e.website&&e.resolution?.status!=='done');
  if(entities.some(e=>e.verification&&!e.verification.reviewMode&&needsVerification(data.project,e)))return 'verify';
  const reads=pendingPageReads(entities,data),checks=pendingBuyerChecks(data.project,entities),budget=data.sourcePipeline.budget;
  const canLocate=unresolved&&!data.sourcePipeline.resolutionPause&&budget?.search!==0;
  if(checks.length&&(checks.length>=3||(!reads.length&&!canLocate)||budget?.web===0))return 'verify-batch';
  if(reads.length&&(reads.length+checks.length>=3||!canLocate))return 'read-sites';
  if(canLocate)return 'resolve';
  if(checks.length)return 'verify-batch';
  if(reads.length)return 'read-sites';
  return null;
}
const verificationKey=(project,e)=>hash(JSON.stringify([entityContextKey(project),e.website]));
function needsVerification(project,e){
  const expiry=Date.parse(e.verification?.completedAt||'')+86400000;
  return e.website&&(e.verification?.inputKey!==verificationKey(project,e)||!Number.isFinite(expiry)||expiry<=Date.now());
}
export async function buyerPipeline(data,stage,api,checkpoint,entityId,resolutionPlan,allowedEntityIds,renderEmptyHtml=false,sourceIds){
  if(!buyerStages.includes(stage))throw Error('BUYER_STAGE_INVALID');
  const pipeline=prepareSources(data);reviewSavedResolutions(data);await checkpoint();
  if(stage==='prepare')return '来源已整理，原始候选与响应完整保留；下一步识别被提及企业。';
  const entities=currentEntities(data).filter(e=>(!entityId||e.id===entityId)&&(!allowedEntityIds||allowedEntityIds.includes(e.id)));
  if(stage==='read-sites')return collectBuyerPages(data,entities,api,checkpoint,renderEmptyHtml);
  if(stage==='verify-batch')return verifyBuyerBatch(data,entities,api,checkpoint);
  if(stage==='extract'){
    const contextHash=entityContextKey(data.project);
    const pages=data.sourcePages.filter(p=>(!sourceIds||sourceIds.includes(p.id))&&(p.extractionContext!==contextHash||p.extractedContentHash!==p.contentHash)).slice(0,20);
    while(pages.length>1&&Buffer.byteLength(JSON.stringify(entityMessages(data.project,pages)),'utf8')>40000)pages.pop();
    if(!pages.length)return '全部现有来源已识别；重复操作没有新增模型请求。';
    const key=extractionKey(data.project,pages),prior=pipeline.extractions.find(r=>r.key===key);
    if(prior){
      if(prior.status==='done'){for(const p of pages)Object.assign(p,{extractionContext:contextHash,extractedContentHash:p.contentHash});await checkpoint();}
      return prior.status==='done'?'该来源批次已识别，复用已保存结果。':'该批次识别未通过，保留原结果；需修正输入或核对模型记录。';
    }
    try{
      const result=await api.model(entityMessages(data.project,pages));
      const checked=checkedEntityBatch(result,pages);applyEntities(data,checked,key);api.commit?.();await checkpoint();
      return '已保存来源分类与企业假设；官网、当地经营和采购主体仍需核实。';
    }catch(e){pipeline.extractions.push({key,sourceIds:pages.map(p=>p.id),status:'failed',error:e.message,failedAt:new Date().toISOString()});await checkpoint();throw e;}
  }
  if(stage==='resolve'){
    if(locatorPlanIds.includes(resolutionPlan)){
      const entity=entities.find(e=>(!e.website||resolutionPlan==='buyer-market-v2'||resolutionPlan==='apollo-name-v1'&&!e.ownership?.verified)&&!e.resolutionAttempt&&
        ![...(e.resolutionHistory||[]),e.resolution].some(r=>r?.status==='done'&&r.query===selectLocatorPlan(e,data.project,resolutionPlan).query&&(r.provider||'langsearch')===selectLocatorPlan(e,data.project,resolutionPlan).provider));
      if(!entity)return '当前方案已处理或官网已保存，未重复查询。';
      await locateEntity(data,entity,api,checkpoint,!!entityId,resolutionPlan);api.commit?.();await checkpoint();return entity.name+'：'+entity.status;
    }
    const entity=entities.find(e=>!e.website&&(resolutionPlan==='concise-v1'?
      ![...(e.resolutionHistory||[]),e.resolution].some(r=>r?.status==='done'&&r.query===resolutionQueries(e,data.project,true)[1]):e.resolution?.status!=='done'));
    if(!entity)return '没有待定位的企业；未找到官网的结果已保留，不重复购买同一查询。';
    await locateEntity(data,entity,api,checkpoint,!!entityId,resolutionPlan);api.commit?.();await checkpoint();return entity.name+'：'+entity.status;
  }
  const entity=currentEntities(data).find(e=>needsVerification(data.project,e));
  if(!entity)return '当前官网候选已核查，未新增模型或官网请求。';
  const inputKey=hash(JSON.stringify([entityContextKey(data.project),entity.website]));
  let page;
  try{page=await api.read(entity.website,'网页');}
  catch(error){
    const read=data.requests.filter(r=>r.service==='public_web'&&r.requestBody.url===entity.website).at(-1);
    if(read?.status!=='failed')throw error;
    entity.websitePages ||= [];entity.websitePages.push({url:entity.website,readFailure:error.message,retrievedAt:new Date().toISOString()});
    entity.verification={inputKey:verificationKey(data.project,entity),completedAt:new Date().toISOString(),readFailure:error.message};
    entity.status='官网读取受限，资料保留待核实';
    const next=(entity.siteCandidates||[]).find(s=>!entity.websitePages.some(p=>p.url===s.url));if(next)entity.website=next.url;
    await checkpoint();return entity.name+'：'+entity.status;
  }
  entity.websitePages ||= [];entity.websitePages.push({url:page.url,content:page.content,readScope:page.readScope,retrievedAt:new Date().toISOString()});await checkpoint();
  const contextHash=entityContextKey(data.project),sourceHash=hash(page.content);
  const result=entity.verification?.contextHash===contextHash&&entity.verification?.sourceHash===sourceHash?
    entity.verification.result:await api.model(ownershipMessages(data.project,entity,page));
  const company=applyOwnership(data,entity,page,result);
  entity.verification={inputKey:verificationKey(data.project,entity),contextHash,sourceHash,result:structuredClone(result),completedAt:new Date().toISOString()};
  if(!company){
    const next=(entity.siteCandidates||[]).find(s=>!entity.websitePages.some(p=>p.url===s.url));
    if(next)entity.website=next.url;
  }
  api.commit?.();await checkpoint();return entity.name+'：'+entity.status;
}
