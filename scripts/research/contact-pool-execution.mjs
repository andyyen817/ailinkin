import {hash} from './core.mjs';
import {transport} from './http.mjs';
import {contactVision,contactPromptVersion,contactExtractionKey} from './contact-vision.mjs';
import {reviewContactOutput,contactReviewVersion} from './contact-output-review.mjs';
import {collectContactPool,contactPoolOptions} from './contact-source-pool.mjs';
const material=(blocks,images=[])=>hash(JSON.stringify([blocks.map(b=>[b.sourceUrl,hash(b.text)]).sort(),images.map(i=>[i.sourceUrl,i.contentHash]).sort()]));
export function recoverKnownContactPools(data,batch,now=Date.now()){
  let recovered=0;
  for(const run of data.contactResearchRuns||[]){
    if(run.batchId!==batch.id||(run.state!=='blocked'&&(run.state!=='done'||run.extraction?.reviewVersion===contactReviewVersion))||run.page?.method!=='company_source_pool'||!batch.companyIds.includes(run.companyId))continue;
    if(run.requests?.some(q=>['pending','unknown'].includes(q.status)))continue;
    const request=run.requests?.findLast(q=>q.service==='ai'&&q.status==='done'&&q.httpStatus===200),choice=request?.response?.choices?.[0];
    if(choice?.finish_reason!=='stop'||typeof choice.message?.content!=='string')continue;
    const company=data.companies.find(c=>c.id===run.companyId);if(!company)continue;
    const raw=JSON.parse(choice.message.content),input={company,blocks:run.page.blocks,images:run.images||[]};
    const reviewed=reviewContactOutput(raw,input);
    (run.recoveryHistory||=[]).push({originalState:run.state,reason:run.reason,recoveredAt:new Date(now).toISOString(),action:'review_known_response',externalRequests:0});
    run.extraction={...reviewed,extractionKey:contactExtractionKey(input),promptVersion:contactPromptVersion};
    run.people=reviewed.people;run.unknowns=reviewed.unknowns;run.state='done';run.expiresAt=new Date(now+86400000).toISOString();run.finishedAt=new Date(now).toISOString();recovered++;
  }
  return recovered;
}
/** @param {any} data @param {any} company @param {any} batch @param {any} scope @param {Function} checkpoint @param {{campaignId?:string,keys?:Record<string,string|undefined>,fetcher?:typeof fetch,loadImage?:(id:string)=>Promise<Buffer>,beforeSend?:(item:any)=>Promise<any>,now?:()=>number}} options */
export async function executeContactPool(data,company,batch,scope,checkpoint,{campaignId,keys={},fetcher=fetch,loadImage,beforeSend,now=()=>Date.now()}={}){
  if(!campaignId||scope.tenantId!==data.project.tenantId||scope.campaignId!==campaignId||scope.batchId!==batch.id||!batch.companyIds.includes(company.id)||Date.parse(scope.expiresAt)<=now())throw Error('CONTACT_POOL_SCOPE_MISMATCH');
  const runs=data.contactResearchRuns||=[],pool=collectContactPool(data,company,now(),contactPoolOptions(scope,company.id));
  if(runs.some(r=>r.requests?.some(q=>['pending','unknown'].includes(q.status))))throw Error('CONTACT_REQUEST_UNKNOWN');
  if(!pool.blocks.length&&!pool.images.length)return {state:'no_evidence',digest:pool.digest,coverage:pool.coverage,reused:true};
  const cache=runs.findLast(r=>r.companyId===company.id&&r.state==='done'&&Date.parse(r.expiresAt)>now()&&r.extraction?.promptVersion===contactPromptVersion&&
    (r.poolDigest===pool.digest||material(r.page?.blocks||[],r.images)===material(pool.blocks,pool.images)));
  if(cache)return {state:'cached',digest:pool.digest,coverage:pool.coverage,run:cache,reused:true};
  const used=runs.filter(r=>r.batchId===batch.id).flatMap(r=>r.requests||[]);
  if(used.filter(q=>q.service==='ai').length>=scope.maxModelRequests||used.reduce((n,q)=>n+(q.reservedCost||0),0)+0.05>scope.maxSpendUsd)return {state:'budget_reached',digest:pool.digest,coverage:pool.coverage,reused:true};
  const run={id:'CE-'+hash(JSON.stringify([batch.id,company.id,pool.digest])).slice(0,24),scopeId:scope.id,batchId:batch.id,companyId:company.id,companyName:company.name,
    platform:'汇总',url:company.website,pageKey:pool.digest,poolDigest:pool.digest,state:'running',requests:[],people:[],channels:pool.channels,images:pool.images,unknowns:[],
    sourcePlatforms:pool.coverage.sourcePlatforms,sourceOrigins:pool.origins,coverage:pool.coverage,createdAt:new Date(now()).toISOString(),sent:0,
    page:{state:'read',method:'company_source_pool',blocks:pool.blocks,coverage:pool.coverage}};
  if(runs.some(r=>r.id===run.id))throw Error('CONTACT_POOL_ALREADY_ATTEMPTED');runs.push(run);await checkpoint();
  try{
    const ledger={requests:run.requests,project:{maxRequests:1,maxSpendUsd:0.05}},call=transport(ledger,{keys,live:true,costUpperBound:{ai:0.05},cacheSeconds:{ai:86400},beforeSend},checkpoint,fetcher);
    run.extraction=await contactVision(call,{company,blocks:pool.blocks,images:pool.images,loadImage});call.commit();
    run.people=run.extraction.people;run.unknowns=[...run.extraction.unknowns,...(pool.coverage.omittedBlocks.length||pool.coverage.omittedImages?['输入上限之外的原始资料已保留，尚未分析。']:[])];
    run.state='done';run.expiresAt=new Date(now()+86400000).toISOString();run.finishedAt=new Date(now()).toISOString();await checkpoint();
    return {state:'done',digest:pool.digest,coverage:pool.coverage,run,reused:false};
  }catch(e){run.state=run.requests.some(q=>['unknown','pending'].includes(q.status))?'unknown':'blocked';run.reason=String(e.message||e);await checkpoint();throw e;}
}
