import type {MarketSource,MarketReport} from './market-research';
import {sourceContext,statementNature} from './company-evidence';
import {marketKey,mentionedMarkets} from './target-markets';
import {officeAddressMarket,businessLocationQuote} from './office-address-market';
type Claim=MarketReport['buyers'][number];
export function planClaims(report:MarketReport):Claim[]{return [
  ...(report.offerings||[]).flatMap(o=>[o.description,...o.applications]),
  ...(report.usps||[]).flatMap(u=>[u.feature,u.value,u.comparison]),
  ...(report.entryConditions||[]).flatMap(e=>[e.requirement,e.ourReadiness]),
  ...(report.searchRecommendations||[]).map(s=>s.reason),
  ...report.competitors.flatMap(c=>[...c.products||[],...c.prices||[],...c.services||[],...c.presence?[c.presence.evidence]:[]]),
];}
function ownFact(claim:Claim,sources:MarketSource[]){
  if(claim.kind!=='fact')return;
  for(const ref of claim.references){const source=sources.find(s=>s.id===ref.sourceId);
    if(!source||source.kind!=='enterprise')throw Error('OUR_CAPABILITY_ENTERPRISE_SOURCE_REQUIRED');
    const context=sourceContext({id:source.id.replace(/^enterprise-/,''),label:source.title,text:source.text,kind:'provided'},ref.quote);
    if(statementNature(context,source.id.replace(/^enterprise-/,'')))throw Error('OUR_CAPABILITY_NOT_CURRENT_AFFIRMATIVE');
  }
}
export function validatePlanEvidence(report:MarketReport,sources:MarketSource[]){
  for(const o of report.offerings||[])ownFact(o.description,sources);
  for(const u of report.usps||[]){ownFact(u.feature,sources);
    if(u.comparison.kind==='fact'&&!u.comparison.references.some(r=>sources.find(s=>s.id===r.sourceId)?.kind!=='enterprise'))throw Error('USP_COMPARISON_EXTERNAL_EVIDENCE_REQUIRED');}
  for(const e of report.entryConditions||[])ownFact(e.ourReadiness,sources);
  for(const c of report.competitiveness)ownFact(c.ourPosition,sources);
  for(const c of report.competitors){
    if(c.presence?.status!=='local_evidence')continue;
    if(c.presence.evidence.kind!=='fact')throw Error('LOCAL_COMPETITOR_FACT_REQUIRED');
    const refs=c.presence.evidence.references.map(r=>({ref:r,source:sources.find(s=>s.id===r.sourceId)}));
    const currentRefs=refs.filter(({ref,source})=>!(/\b(?:will|planned|proposed|expected to|intends to)\b|计划|拟建|将设|将提供/i.test(ref.quote))&&!sources.some(s=>s.url&&s.url===source?.url&&
      /(?:submitted|indexed|moderated)[^.!?]{0,60}this listing\s*[·-]?\s*[1-9]\d*\s*years ago/i.test(s.text)));
    if(!currentRefs.some(({ref,source})=>source?.url&&source.kind!=='enterprise'&&(source.kind!=='search'||source.evidenceType==='body'||
      (source.evidenceType==='provider_text'&&source.providerRequestId&&source.captureLimit))&&(mentionedMarkets(businessLocationQuote(ref.quote),c.market).includes(marketKey(c.market))||officeAddressMarket(businessLocationQuote(ref.quote),c.market))&&
      (source.text+' '+source.title).toLowerCase().includes(c.name.toLowerCase())))throw Error('LOCAL_COMPETITOR_BODY_EVIDENCE_REQUIRED');
  }
}
