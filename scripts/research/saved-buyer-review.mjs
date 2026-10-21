import {hash} from './core.mjs';
import {buyerPages,pageEvidenceId} from './buyer-site-pages.mjs';
import {checkedBuyerResult,savedBuyerPage,buyerInputHash,buyerVerificationContext} from './buyer-verification.mjs';
import {applyOwnership,reconcileVerifiedWebsiteAttempts} from './buyer-resolution.mjs';

// Repair representation only. Decisions, unknowns and conflicts remain unchanged.
export function normalizedSavedResult(entity,raw){
  const result=structuredClone(raw),q=result.qualification;
  if(!q||typeof q!=='object')return null;
  for(const key of ['direction','criticalUnknowns','conflicts','followUpQuestions']){
    if(q[key]!==undefined&&result[key]!==undefined&&JSON.stringify(q[key])!==JSON.stringify(result[key]))return null;
    if(q[key]===undefined&&result[key]!==undefined)q[key]=structuredClone(result[key]);
  }
  const pages=buyerPages(entity);
  for(const claim of [result.ownership,...['identity','market','buyer','cooperation'].map(k=>q[k])]){
    if(!claim?.matched||typeof claim.quote!=='string')continue;
    const page=pages.find(p=>pageEvidenceId(entity,p)===(claim.evidenceId||'web:'+entity.id));
    if(!page||page.content.includes(claim.quote))continue;
    const text=page.content.slice(0,6000),positions=[],compact=text.split('').filter((c,i)=>{if(/\s/u.test(c))return false;positions.push(i);return true;}).join('');
    const quote=claim.quote.replace(/\s/gu,''),start=compact.indexOf(quote);
    if(start<0||!quote)continue;
    const exact=text.slice(positions[start],positions[start+quote.length-1]+1);
    claim.originalQuote=claim.quote;claim.quote=exact;
  }
  return result;
}
export async function recheckSavedBuyers(data,entities,checkpoint){
  const repaired=reconcileVerifiedWebsiteAttempts(data,entities);
  const reviews=data.sourcePipeline.savedResultReviews ||= [];let accepted=0,rejected=0,reused=0;
  for(const entity of entities){
    if(entity.ownership?.verified&&entity.verification?.contextHash===hash(JSON.stringify(buyerVerificationContext(data.project)))&&
      entity.verification?.sourceHash===hash(JSON.stringify(buyerPages(entity).map(p=>[p.url,p.content])))&&checkedBuyerResult(entity,entity.verification.result)){reused++;continue;}
    const batch=[...(data.sourcePipeline.verificationBatches||[])].reverse().find(b=>Array.isArray(b.result?.results)&&b.result.results.some(r=>r.entityId===entity.id));
    if(!batch)continue;
    const matches=batch.result.results.filter(r=>r.entityId===entity.id),inputHash=buyerInputHash(data.project,entity),key=hash(JSON.stringify([batch.key,inputHash,'saved-shape-v1']));
    if(reviews.some(r=>r.key===key)){reused++;continue;}
    const result=matches.length===1?normalizedSavedResult(entity,matches[0]):null,page=savedBuyerPage(entity);
    const inputUnchanged=entity.batchFailure?.key===batch.key&&entity.batchFailure.inputHash===inputHash;
    const valid=inputUnchanged&&!!page&&!!result&&checkedBuyerResult(entity,result);
    if(valid){applyOwnership(data,entity,page,result,buyerPages(entity));accepted++;}else rejected++;
    reviews.push({key,batchKey:batch.key,entityId:entity.id,inputHash,accepted:valid,normalizedResult:result,completedAt:new Date().toISOString(),reason:valid?'字段归位与空白格式复核；关键未知保留':inputUnchanged?'引用或归属依据仍不足，未改变结果':'输入范围已变更，旧模型结论不能用于当前判断'});
  }
  await checkpoint();return `已复核保存结果：${accepted} 家结构与引用通过，${rejected} 家依据不足，${reused} 家复用；官网任务状态修复 ${repaired} 项，关键未知保留，没有外部调用。`;
}
