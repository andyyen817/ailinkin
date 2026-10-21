import 'server-only';
import type {Prisma} from '@/generated/prisma/client';
import {AccessError} from './policy';
import {draftGroups} from './company-analysis-model';
import type {AnalysisRow} from './company-analysis-store';
import {searchHistory, resolveHistory, historyChoices} from './search-history';
import {checkedQuality} from './company-reviewed-analysis';
import {exclusionDomains,webProviderFor,searchCapabilities} from '../../scripts/research/search-capabilities.mjs';
import {marketKey} from '@/domain/target-markets';
import {developmentGroups} from './market-development-plan';

const sharedSites = ['facebook.com', 'instagram.com', 'x.com', 'linkedin.com', 'reddit.com', 'tiktok.com', 'xiaohongshu.com', 'alibaba.com', 'made-in-china.com'];
export function companyDomain(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!host.includes('.') || sharedSites.some(site => host === site || host.endsWith('.' + site))) return null;
    return host;
  } catch {return null;}
}
export function relatedExclusions(semanticKey: string, histories: any[], ownCompanies: any[] = []) {
  const companies = [...ownCompanies, ...histories.filter(h => h.project?.buyerGroup?.semanticKey === semanticKey).flatMap(h => h.companies || [])];
  const domains = new Set<string>();
  for (const company of companies) {
    if (company.sourceOnly || company.sharedDomain || company.organizationType === 'store') continue;
    const domain = companyDomain(String(company.website || ''));
    if (domain) domains.add(domain);
  }
  return [...domains].sort();
}
export function boundedExclusions(domains: string[], limit = 100) {
  const normalized = [...new Set(domains)].sort();
  if (normalized.some(d => !d.includes('.') || /[\s/|,]/.test(d))) throw new AccessError('INVALID_EXCLUSION_DOMAIN', 400);
  if (normalized.length > limit) throw new AccessError('EXCLUSION_CAPACITY_REQUIRES_REVIEW', 409);
  return normalized;
}
export function providerExclusions(provider:string,domains:string[]){
  try{return exclusionDomains(provider,domains);}catch(e){throw new AccessError((e as Error).message,409);}
}
export function selectSearchGroup(groups:ReturnType<typeof draftGroups>,profileId:string,market?:string){
  const available=groups.filter(g=>g.profileId===profileId);
  if(!market&&available.length>1)throw new AccessError('TARGET_MARKET_REQUIRED',409);
  const group=market?available.find(g=>marketKey(g.market)===marketKey(market)):available[0];
  if(!group)throw new AccessError('TARGET_MARKET_NOT_AVAILABLE',409);
  if(!group.ready)throw new AccessError('PROFILE_NEEDS_INFORMATION',409);
  return group;
}
export async function analysisSearchPlan(tx: Prisma.TransactionClient, row: AnalysisRow, profileId: string, selected: string[] = [],market?:string) {
  if (row.state !== 'complete' || !row.data.report) throw new AccessError('ANALYSIS_NOT_READY', 409);
  const quality=checkedQuality(row.data.report,row.data.input,row.data.sources);
  if(!quality) throw new AccessError('ANALYSIS_REVIEW_REQUIRED',409);
  if(!quality.buyers.find(b=>b.id===profileId)?.ready) throw new AccessError('BUYER_CHECK_REQUIRED',409);
  const original = selectSearchGroup(draftGroups(row.data.input, row.data.report),profileId,market);
  const snapshot=(row.data as any).marketResearch?.find((s:any)=>marketKey(s.market)===marketKey(original.market));
  const group = snapshot?developmentGroups(row,snapshot).groups.find(g=>g.profileId===profileId)||original:original;
  const histories = await searchHistory(tx, row.tenant_id);
  const related = resolveHistory(group, histories, selected);
  const excludedDomains = relatedExclusions(group.semanticKey, [], related.flatMap(h => h.companies));
  const provider=webProviderFor(group.market,process.env);
  const supplier={companyName:row.data.input.companyName,business:row.data.input.business,
    capabilities:row.data.report.capabilities,limitations:row.data.report.limitations,
    facts:quality.statements.map(s=>({id:s.id,kind:s.kind,quote:s.quote,sourceId:s.sourceId,context:s.context})),
    analysisId:row.id,analysisVersion:row.version};
  return {...group,supplier, excludedDomains,webSource:{provider,excludeLimit:searchCapabilities[provider]?.exclusionLimit??null},relatedCampaignIds: [...new Set(selected)].sort(),
    historyChoices: historyChoices(group, histories, related), analysisId: row.id, analysisVersion: row.version};
}
