import {z} from 'zod';
import {marketKey} from './target-markets';
import {sharedResearchBudget} from './shared-research-budget';
import {marketClaim} from './market-claims';
import {planSections,competitorDetails} from './market-plan-sections';
import {planClaims,validatePlanEvidence} from './market-plan-evidence';
export {marketClaim} from './market-claims';
export const marketHash=z.string().regex(/^[a-f0-9]{64}$/);
const text=z.string().trim().min(1).max(1800),url=z.url().refine(v=>/^https?:\/\//.test(v)&&!new URL(v).username&&!new URL(v).password);
export const marketSource=z.object({id:z.string().max(120),url:url.optional(),title:z.string().max(800),text:z.string().max(40000),
  kind:z.enum(['enterprise','official','directory','association','search']),market:z.string().max(200),retrievedAt:z.iso.datetime(),contentHash:marketHash,
  links:z.array(url).max(100).default([]),evidenceType:z.enum(['body','snippet','provider_text']).optional(),
  providerRequestId:z.string().min(1).max(120).optional(),captureLimit:z.number().int().min(1).max(40000).optional()}).strict();
export type MarketSource=z.infer<typeof marketSource>;
export const marketReport=z.object({summary:text,buyers:z.array(marketClaim).max(20),channels:z.array(marketClaim).max(20),
  competitors:z.array(z.object({name:text,website:url.optional(),market:text,claims:z.array(marketClaim).min(1).max(12),...competitorDetails}).strict()).max(30),
  competitiveness:z.array(z.object({dimension:text,ourPosition:marketClaim,marketRequirement:marketClaim,assessment:marketClaim}).strict()).max(15),
  unknowns:z.array(text).max(30),nextActions:z.array(text).max(20),...planSections}).strict();
export type MarketReport=z.infer<typeof marketReport>;
export function checkedMarketReport(raw:unknown,sources:MarketSource[]){
  const report=marketReport.parse(raw),all=[...report.buyers,...report.channels,...report.competitors.flatMap(c=>c.claims),
    ...report.competitiveness.flatMap(c=>[c.ourPosition,c.marketRequirement,c.assessment]),...planClaims(report)];
  for(const c of all)for(const ref of c.references){const s=sources.find(s=>s.id===ref.sourceId);
    if(!s||!s.text.includes(ref.quote))throw Error('MARKET_REFERENCE_INVALID');}
  for(const c of report.competitors){
    const refs=c.claims.flatMap(c=>c.references),external=refs.map(r=>sources.find(s=>s.id===r.sourceId)).filter(s=>s?.url);
    if(!external.length)throw Error('COMPETITOR_EXTERNAL_EVIDENCE_REQUIRED');
    const website=c.website;
    if(website&&!external.some(s=>s!.url===website||s!.links.includes(website)))throw Error('COMPETITOR_WEBSITE_NOT_OBSERVED');
  }
  validatePlanEvidence(report,sources);return report;
}
export const marketResearchInput=z.object({action:z.enum(['prepare','collect','run']),analysisId:z.uuid(),expectedVersion:z.number().int().min(1),market:text.max(100)}).strict();
export const marketScope=z.object({id:z.string().regex(/^MARKET-[A-Z0-9-]{1,80}$/),enabled:z.literal(true),tenantId:z.uuid(),analysisId:z.uuid(),
  inputHash:marketHash,markets:z.array(text.max(100)).min(1).max(20),approvedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),
  maxSearchRequests:z.number().int().min(0).max(100),maxModelRequests:z.number().int().min(0).max(20),maxSpendUsd:z.number().min(0).max(100),
  continueFreeSearchFailureIds:z.array(z.string().regex(/^Q-[a-f0-9-]{36}$/)).max(10).optional(),
  queries:z.array(text.max(500)).max(100),model:z.literal('deepseek-flash'),sharedBudget:sharedResearchBudget.optional(),
  searchPlans:z.array(z.object({query:text.max(500),count:z.number().int().min(1).max(50),maxCharacters:z.number().int().min(100).max(10000),
    includeDomains:z.array(text.max(253)).max(100),excludeDomains:z.array(text.max(253)).max(100)}).strict()).max(100).optional(),
  reportMode:z.enum(['development_plan']).optional(),
  publicPages:z.object({maxPages:z.number().int().min(0).max(200),maxNetworkRequestsPerPage:z.number().int().min(2).max(32),
    timeoutMs:z.number().int().min(1000).max(20000).optional(),retryFailedObservedUrls:z.array(z.url()).max(1).optional(),preferHttps:z.boolean().optional(),
    purpose:z.enum(['organization_evidence']).optional(),
    observedUrls:z.array(z.url().max(2000).refine(u=>/^https?:\/\//.test(u))).max(20).optional()}).strict().optional(),
  queryMarkets:z.array(z.object({market:text.max(100),inputHash:marketHash,queries:z.array(text.max(500)).max(100)}).strict()).max(20).optional()}).strict();
export function marketScopeFor(raw:unknown,market:string,inputHash:string){
  const s=marketScope.parse(raw),group=s.queryMarkets?.filter(g=>marketKey(g.market)===marketKey(market));
  if(!s.markets.some(m=>marketKey(m)===marketKey(market)))return null;
  if(group){if(!s.sharedBudget||group.length!==1||group[0].inputHash!==inputHash||group[0].queries.some(q=>!s.queries.includes(q)))return null;
    return {...s,inputHash,markets:[market],queries:group[0].queries,searchPlans:s.searchPlans?.filter(p=>group[0].queries.includes(p.query))};}
  return s.markets.length===1&&s.inputHash===inputHash?s:null;
}
export function assertMarketBudget(requests:any[],scope:z.infer<typeof marketScope>,service?:string,cost=0){
  const all=[...new Map(requests.filter(r=>r.scopeId===scope.id&&r.status!=='blocked_before_send').map(r=>[r.id||r.key,r])).values()];
  if(all.filter(r=>r.service==='langsearch').length+(service==='langsearch'?1:0)>scope.maxSearchRequests||all.filter(r=>r.service==='ai').length+(service==='ai'?1:0)>scope.maxModelRequests||Number((all.reduce((n,r)=>n+(r.reservedCost||0),0)+cost).toFixed(8))>scope.maxSpendUsd)throw Error('MARKET_SHARED_BUDGET_REACHED');
}
