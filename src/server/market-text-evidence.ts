import {createHash} from 'node:crypto';
import {reviewMarketReport,MARKET_REVIEW_POLICY} from './market-report-review';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// LangSearch text mode returns source-page text, not a search snippet. Never infer this from text length.
export function hydrateKnownText(snapshot:any){
  let changed=0;
  for(const r of snapshot.requests||[]){
    if(r.service!=='langsearch'||r.status!=='done'||!r.requestBody?.contents?.text||String(r.response?.code)!=='200')continue;
    for(const hit of r.response?.data?.webPages?.value||[]){
      if(typeof hit.text!=='string'||!hit.text.trim())continue;
      const s=snapshot.sources.find((s:any)=>s.url===hit.url&&s.text===hit.text&&s.contentHash===hash(hit.text));
      if(!s||s.kind!=='search'||s.evidenceType==='body'||s.evidenceType==='provider_text')continue;
      s.evidenceType='provider_text';s.providerRequestId=r.id;s.captureLimit=r.requestBody.contents.text.maxCharacters||5000;changed++;
    }
  }
  return changed;
}
export function recheckKnownMarket(snapshot:any){
  if(snapshot.reportOrigin!=='deepseek_flash')return;
  const r=[...snapshot.requests||[]].reverse().find(r=>r.service==='ai'&&r.status==='done'&&r.response?.choices?.[0]?.finish_reason==='stop');
  if(!r)return;
  const checked=reviewMarketReport(JSON.parse(r.response.choices[0].message.content),snapshot.sources,snapshot.market);
  snapshot.report=checked.report;snapshot.reportReview=checked.review;snapshot.reportReviewPolicy=MARKET_REVIEW_POLICY;
  snapshot.localEvidenceReview={requestId:r.id,method:'known_http200_original_draft',newModelCalls:0,time:new Date().toISOString()};
  snapshot.message='已根据实际API正文字段重新校验原模型稿；本次未增加搜索、网页或模型请求。';
}
