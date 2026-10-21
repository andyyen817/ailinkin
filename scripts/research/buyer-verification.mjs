import {hash} from './core.mjs';
import {httpUrl} from './schema.mjs';
import {entityContext,entityContextKey} from './discovery-entities.mjs';
import {applyOwnership,ownershipMessages,invalidateOwnership} from './buyer-resolution.mjs';
import {observedBuyerLinks,buyerPages,pageUrl,pageEvidenceId,visibleBuyerText} from './buyer-site-pages.mjs';
import {pointerSources,explicitSitePointers} from './source-site-pointer.mjs';
import {evidencePackets,materializeBuyerResult,evidenceContract} from './buyer-evidence-contract.mjs';
import {parseModelObject} from './model-json-syntax.mjs';
import {ownershipNames,ownershipNamePresent} from './buyer-identity-names.mjs';
const fresh=p=>Date.parse(p?.retrievedAt||'')+86400000>Date.now();
const canonical=s=>{try{return httpUrl(s);}catch{return null;}};
const visible=p=>p.content.slice(0,6000).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email omitted]');
export function buyerVerificationContext(project){
  const s=project.buyerGroup?.supplier||{};
  const claims=values=>(values||[]).slice(0,8).map(v=>typeof v==='string'?v:{text:v.text||v.claim||v.description||'',source:v.sourceId||'',kind:v.kind||'supplier_statement'});
  return {version:'buyer-pages-v4',...entityContext(project),supplier:{business:String(s.business||project.product||'').slice(0,1500),
    facts:(s.facts||[]).slice(0,8).map(f=>({kind:f.kind,quote:String(f.quote||'').slice(0,600),sourceId:f.sourceId})),
    capabilities:claims(s.capabilities),limitations:claims(s.limitations)}};
}
const contextKey=project=>hash(JSON.stringify(buyerVerificationContext(project)));
const pagesHash=e=>hash(JSON.stringify(buyerPages(e).map(p=>[p.url,p.content])));
export const buyerInputHash=(project,e)=>hash(JSON.stringify([contextKey(project),e.id,e.name,buyerPages(e).map(p=>[p.url,visibleBuyerText(p)])]));
export function savedBuyerPage(entity){
  return (entity.websitePages||[]).filter(p=>p.url&&canonical(p.url)===canonical(entity.website)&&p.content&&fresh(p)).at(-1);
}
export function pendingPageReads(entities,data=undefined){
  return entities.filter(e=>e.website?!(e.siteReadComplete?.url===canonical(e.website)&&fresh(e.siteReadComplete))&&
    !(e.websitePages||[]).some(p=>canonical(p.url)===canonical(e.website)&&p.readFailure&&fresh(p)):
    data&&pointerSources(data,e).some(s=>!(e.referencePages||[]).some(p=>p.url===s.url&&fresh(p))));
}
export function pendingBuyerChecks(project,entities){
  const contextHash=contextKey(project);
  return entities.filter(e=>{
    const page=savedBuyerPage(e);if(!page)return false;
    const inputHash=buyerInputHash(project,e);
    if(e.batchFailure?.inputHash===inputHash)return false;
    return e.verification?.contextHash!==contextHash||e.verification?.sourceHash!==pagesHash(e)||Date.parse(e.verification?.completedAt||'')+86400000<=Date.now();
  });
}
export async function collectBuyerPages(data,entities,api,checkpoint,renderEmptyHtml=false){
  const batch=(renderEmptyHtml?entities.filter(e=>e.siteCandidates?.some(c=>e.websitePages?.some(p=>p.url===c.url&&p.readFailure==='页面正文不足或要求访问验证'))):pendingPageReads(entities,data)).slice(0,5);
  for(const e of batch){
    if(renderEmptyHtml)e.website=e.siteCandidates.find(c=>e.websitePages?.some(p=>p.url===c.url&&p.readFailure==='页面正文不足或要求访问验证')).url;
    if(!e.website){
      const source=pointerSources(data,e)[0];if(!source)continue;
      e.referencePages ||= [];
      try{
        const page=await api.read(source.url,'网页');e.referencePages.push({...page,retrievedAt:new Date().toISOString()});
        const pointers=explicitSitePointers(e,page);e.officialCandidates ||= [];
        for(const p of pointers)if(!e.officialCandidates.some(c=>c.url===p.url))e.officialCandidates.push(p);
        e.website=pointers[0]?.url||'';e.status=e.website?'来源明示官网链接，待核实':'来源没有可核实的明示官网链接';
      }catch(error){
        const request=data.requests.filter(r=>r.service==='public_web'&&r.requestBody.url===source.url).at(-1);
        if(request?.status!=='failed')throw error;
        e.referencePages.push({url:source.url,readFailure:error.message,retrievedAt:new Date().toISOString()});e.status='来源读取受限，不能确认官网';
      }
      await checkpoint();if(!e.website)continue;
    }
    const requested=e.website;
    try{
      const page=await api.read(requested,'网页');page.url=httpUrl(page.url);
      e.websitePages ||= [];e.websitePages.push({...page,retrievedAt:new Date().toISOString()});
      e.website=page.url;e.status='网页资料已保存，官网归属与买方关系待核实';
      const relatedLinks=observedBuyerLinks(page);e.unreadRelatedLinks=relatedLinks.slice(api.buyerRelatedLimit??2);
      for(const url of relatedLinks.slice(0,api.buyerRelatedLimit??2)){
        if(buyerPages(e).some(p=>pageUrl(p.url)===pageUrl(url)))continue;
        try{
          const related=await api.read(url,'网页');
          if(new URL(related.url).origin!==new URL(e.website).origin)throw Error('相关页面重定向归属待核实');
          e.websitePages.push({...related,retrievedAt:new Date().toISOString()});
        }catch(error){
          const request=data.requests.filter(r=>r.service==='public_web'&&canonical(r.requestBody.url)===canonical(url)).at(-1);
          if(!['failed','done'].includes(request?.status))throw error;
          e.websitePages.push({url,readFailure:error.message,retrievedAt:new Date().toISOString()});
        }
        await checkpoint();
      }
      e.siteReadComplete={url:canonical(e.website),retrievedAt:new Date().toISOString()};
    }catch(error){
      const request=data.requests.filter(r=>r.service==='public_web'&&canonical(r.requestBody.url)===canonical(requested)).at(-1);
      if(request?.status!=='failed')throw error;
      e.websitePages ||= [];e.websitePages.push({url:requested,readFailure:error.message,retrievedAt:new Date().toISOString()});
      e.status='网页读取受限，资料保留待核实';
      const next=(e.siteCandidates||[]).find(c=>!e.websitePages.some(p=>p.url===c.url));if(next)e.website=next.url;
    }
    await checkpoint();
  }
  return batch.length?`已处理 ${batch.length} 份网页资料，未调用模型；下一步核实官网归属与买方关系。`:'现有网页资料已保存或读取受限；没有新增网页请求。';
}
export function batchOwnershipMessages(project,entities){
  const first=entities[0],page=savedBuyerPage(first);
  return [{role:'system',content:ownershipMessages(project,first,page)[0].content+
    '\n本次是批量多页面判断。输出 results 数组，每个元素包含 entityId 和上述结构；一一对应输入，不借用别家证据。ownership增加evidenceId，四项判断和ownership都引用对应页面ID。evidence与additionalEvidence均为该企业的候选官网页面，先核实归属。' +
    'supplier仅是我方已提供资料，其中goal不是能力，企业自述未经外部验证；不得据此编造当地交付、认证或买方采购意愿。资料不足时保留未知；合作切入点仅作假设。\n'+evidenceContract},
    {role:'user',content:JSON.stringify({context:buyerVerificationContext(project),items:entities.map(e=>{
      const packets=evidencePackets(e),p=packets.find(p=>canonical(p.url)===canonical(e.website));
      return {entityId:e.id,name:e.name,knownNames:ownershipNames(e),evidence:p,additionalEvidence:packets.filter(v=>v!==p)};
    })})}];
}
export function checkedBuyerResult(entity,result){
  const pages=buyerPages(entity),source=id=>pages.find(p=>pageEvidenceId(entity,p)===id);
  const claim=c=>{const p=source(c?.evidenceId);return p&&typeof c.quote==='string'&&c.quote.length>=8&&visibleBuyerText(p).includes(c.quote);};
  if(!['buyer_site','reference','unrelated','unknown'].includes(result?.siteKind)||typeof result?.ownership?.matched!=='boolean')return false;
  if(!['buys_from_us','refers_orders','unclear'].includes(result.qualification?.direction))return false;
  if(result.ownership.matched&&!claim({...result.ownership,evidenceId:result.ownership.evidenceId||'web:'+entity.id}))return false;
  for(const k of ['identity','market','buyer','cooperation'])if(result.qualification?.[k]?.matched&&!claim(result.qualification[k]))return false;
  return !result.ownership.matched||ownershipNamePresent(entity,result.ownership.quote);
}
export async function verifyBuyerBatch(data,entities,api,checkpoint){
  const batch=pendingBuyerChecks(data.project,entities).slice(0,5);
  while(batch.length>1&&Buffer.byteLength(JSON.stringify(batchOwnershipMessages(data.project,batch)),'utf8')>40000)batch.pop();
  if(!batch.length)return '现有核实结果已保存或有待处理错误；没有新增模型及网页请求。';
  const messages=batchOwnershipMessages(data.project,batch),key=hash(JSON.stringify(messages));
  const records=data.sourcePipeline.verificationBatches ||= [],prior=records.find(b=>b.key===key);
  const saved=data.requests.findLast(r=>r.service==='ai'&&r.status==='done'&&r.response?.choices?.[0]?.finish_reason==='stop'&&JSON.stringify(r.requestBody?.messages)===JSON.stringify(messages));
  let recovered;
  if(prior?.status==='failed'&&prior.error==='模型 JSON 格式不正确'&&saved){try{recovered=parseModelObject(saved.response.choices[0].message.content);}catch{}}
  if(prior&&['failed','unknown'].includes(prior.status)&&!recovered)return '该批核实已有失败或未知记录，保留原结果，未重复调用。';
  let result;
  try{result=recovered||prior?.result||await api.model(messages);}
  catch(error){
    records.push({key,status:data.requests.some(r=>r.status==='unknown')?'unknown':'failed',error:error.message,completedAt:new Date().toISOString()});
    await checkpoint();throw error;
  }
  if(!Array.isArray(result.results)){
    records.push({key,status:'failed',result,error:'批量结果结构不完整',completedAt:new Date().toISOString()});
    await checkpoint();throw Error('批量结果结构不完整，原响应保留，未重新调用。');
  }
  let accepted=0;const rejected=[];
  for(const e of batch){
    const p=savedBuyerPage(e),contextHash=contextKey(data.project),inputHash=buyerInputHash(data.project,e);
    const matches=result.results.filter(r=>r.entityId===e.id),r=materializeBuyerResult(e,matches[0]);
    if(matches.length!==1||!checkedBuyerResult(e,r)){
      e.batchFailure={key,inputHash,reason:'该企业结果缺失、重复或没有本网页归属证据'};invalidateOwnership(data,e,'批量判断依据不足，原结果保留待核实');rejected.push(e.id);continue;
    }
    applyOwnership(data,e,p,r,buyerPages(e));e.verification={reviewMode:'batch-v2',contextHash,sourceHash:pagesHash(e),result:structuredClone(r),completedAt:new Date().toISOString()};delete e.batchFailure;accepted++;
  }
  if(!prior||recovered)records.push({key:recovered?key+':local-syntax':key,status:rejected.length?'partial':'done',result,accepted,rejected,...(recovered?{recoveredFromRequest:saved.id,originalFailureKey:key}:{}),completedAt:new Date().toISOString()});
  api.commit?.();await checkpoint();
  return `已保存 ${accepted} 家官网与买方判断，${rejected.length} 家依据不足；没有发送邮件。`;
}
