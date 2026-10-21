import 'server-only';
import fs from 'node:fs/promises';
import type {Prisma} from '@/generated/prisma/client';
import type {AnalysisRow} from './company-analysis-store';
import type {Campaign} from '@/domain/research';
import {marketScope,marketScopeFor} from '@/domain/market-research';
import {marketKey} from '@/domain/target-markets';
import {cachedMarketSnapshot,marketInputHash,marketDigest} from './market-research-summary';
import {AccessError} from './policy';
import {createDevelopmentPlan,developmentPlanMarkdown} from './market-development-plan';
import {hydrateKnownText,recheckKnownMarket} from './market-text-evidence';
import {MARKET_REVIEW_POLICY} from './market-report-review';
import {reviewKnownDnsFailures} from './market-public-evidence';
import {hasBlockingMarketRequest} from './market-free-error';
export function marketEntries(row:AnalysisRow):any[]{return (row.data as any).marketResearch||[];}
export function releaseOwnedMarketLease(snapshot:any,token:string){
  if(snapshot?.lease?.token!==token)return false;
  delete snapshot.lease;return true;
}
export function prepareMarket(row:AnalysisRow,market:string,campaigns:Campaign[],scope:ReturnType<typeof marketScope.parse>|null=null){
  if(!row.data.report)throw new AccessError('ANALYSIS_NOT_READY',409);
  const fresh=cachedMarketSnapshot(row,market,campaigns),old=marketEntries(row).find(s=>marketKey(s.market)===marketKey(market));
  if(old?.state==='unknown'&&reviewKnownDnsFailures(old)&&!old.lease&&
    ![...old.requests||[],...old.pageReads||[]].some((r:any)=>['pending','unknown'].includes(r.status))){
    old.state='partial';old.message='已核对域名解析失败：尚未连接到网站；原记录保留，不重新访问该网址。';
  }
  if(old?.state==='unknown'&&!old.lease&&marketExecutionStatus(row,market,scope).enabled&&
    !hasBlockingMarketRequest([...old.requests||[],...old.pageReads||[]],scope)){
    old.state='partial';old.message='免费只读搜索502原记录保留、计入额度且不重发；继续本批其他已批准来源。';
  }
  if(old&&['running','unknown'].includes(old.state))throw new AccessError('MARKET_BUSY_OR_UNKNOWN',409);
  if(old?.inputHash===fresh.inputHash){
    fresh.sources=fresh.sources.map(s=>old.sources.find((p:any)=>p.id===s.id&&p.contentHash===s.contentHash)||s);
    for(const s of old.sources)if(s.kind==='search'&&!fresh.sources.some(p=>p.id===s.id))fresh.sources.push(s);
    const same=marketDigest(fresh.sources)===marketDigest(old.sources);
    const next={...old,...fresh,requests:old.requests||[],searches:old.searches||[],modelScope:old.modelScope,modelInputHash:old.modelInputHash,
      report:old.report,reportOrigin:old.reportOrigin,state:old.state,message:old.message,sourcePhase:old.sourcePhase,
      reportPending:old.reportPending||!same,revision:(old.revision||0)+(same?0:1)};
    if(hydrateKnownText(next)||next.reportOrigin==='deepseek_flash'&&next.reportReviewPolicy!==MARKET_REVIEW_POLICY){next.reportOrigin=old.reportOrigin;recheckKnownMarket(next);next.revision++;}return next;
  }
  return {...fresh,revision:1};
}
export function setMarket(row:AnalysisRow,snapshot:any){
  snapshot.developmentPlan=createDevelopmentPlan(row,snapshot);
  snapshot.developmentPlan.markdown=developmentPlanMarkdown(snapshot);
  const data=row.data as any,old=marketEntries(row).find(s=>marketKey(s.market)===marketKey(snapshot.market));
  if(old&&old.inputHash!==snapshot.inputHash){if((data.marketResearchHistory||[]).length>=100)throw new AccessError('MARKET_HISTORY_LIMIT',409);(data.marketResearchHistory||=[]).push(old);}
  data.marketResearch=[...marketEntries(row).filter(s=>marketKey(s.market)!==marketKey(snapshot.market)),snapshot];
}
export async function persistMarket(tx:Prisma.TransactionClient,row:AnalysisRow,previousData:string){
  const count=await tx.$executeRaw`UPDATE company_analysis SET data=${JSON.stringify(row.data)}::jsonb
    WHERE id=${row.id} AND tenant_id=${row.tenant_id} AND version=${row.version} AND data=${previousData}::jsonb`;
  if(count!==1)throw new AccessError('ANALYSIS_VERSION_CONFLICT',409);
}
export async function readMarketScope(){try{return marketScope.parse(JSON.parse(await fs.readFile(/* turbopackIgnore: true */ process.env.MARKET_RESEARCH_SCOPE_PATH||'.runtime/market-research-scope.json','utf8')));}catch{return null;}}
export function marketExecutionStatus(row:AnalysisRow,market:string,scope:ReturnType<typeof marketScope.parse>|null){
  const selected=scope?marketScopeFor(scope,market,marketInputHash(row,market)):null;
  const sharedAllowed=!selected?.sharedBudget||(selected.sharedBudget.analysisId===row.id&&Date.now()+60000<Date.parse(selected.sharedBudget.expiresAt)&&Date.parse(selected.sharedBudget.expiresAt)<=Date.parse(selected.expiresAt));
  const enabled=!!selected&&selected.tenantId===row.tenant_id&&selected.analysisId===row.id&&selected.inputHash===marketInputHash(row,market)&&
    selected.markets.some(m=>marketKey(m)===marketKey(market))&&Date.now()+60000<Date.parse(selected.expiresAt)&&sharedAllowed;
  return {enabled,scope:enabled&&selected?{id:selected.id,maxSearchRequests:selected.maxSearchRequests,maxModelRequests:selected.maxModelRequests,maxSpendUsd:selected.maxSpendUsd,expiresAt:selected.expiresAt}:null,
    notice:enabled?'使用本批确认额度，保存原始响应与来源':'本批真实市场搜索额度未启用；可先查看和复用已保存资料'};
}
