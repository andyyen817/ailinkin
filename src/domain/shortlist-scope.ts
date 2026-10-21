import {z} from 'zod';
import {sharedResearchBudget} from './shared-research-budget';
export const shortlistScope=z.object({kind:z.literal('market-shortlist'),id:z.string().min(1).max(100),tenantId:z.uuid(),analysisId:z.uuid(),analysisVersion:z.number().int().positive(),
  campaignIds:z.array(z.uuid()).length(2),markets:z.array(z.string().min(1)).length(2),startedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),
  windows:z.array(z.object({startedAt:z.iso.datetime(),expiresAt:z.iso.datetime()}).strict()).min(1).max(10).optional(),
  continuedUnknownFreeRequestIds:z.array(z.string().min(1)).max(10).optional(),
  freeEligibility:z.object({plan:z.literal('Free Plan'),status:z.literal('Active'),observedAt:z.iso.datetime(),evidence:z.string().min(1)}).strict(),
  sharedBudget:sharedResearchBudget}).strict();
export function checkedShortlistScope(raw:unknown,row:any,now=Date.now()){
  const scope=shortlistScope.parse(raw),b=scope.sharedBudget,p=row.data.project;
  if(scope.tenantId!==row.tenant_id||p.tenantId!==row.tenant_id||!scope.campaignIds.includes(row.id)||new Set(scope.campaignIds).size!==2||
    !scope.markets.includes(p.country)||new Set(scope.markets).size!==2||scope.analysisId!==p.analysis?.id||scope.analysisVersion!==p.analysis?.version||
    b.analysisId!==scope.analysisId||b.expiresAt!==scope.expiresAt||!p.buyerGroup?.ready||!p.buyerGroup.searchSpecs?.length||p.discoveryProvider!=='web'||p.webProvider!=='langsearch')throw Error('SHORTLIST_SCOPE_MISMATCH');
  const windows=scope.windows||[{startedAt:scope.startedAt,expiresAt:scope.expiresAt}],observed=Date.parse(scope.freeEligibility.observedAt);
  if(windows[0].startedAt!==scope.startedAt||windows.at(-1)!.expiresAt!==scope.expiresAt||windows.some((w,i)=>Date.parse(w.expiresAt)<=Date.parse(w.startedAt)||Date.parse(w.expiresAt)-Date.parse(w.startedAt)>3600000||i>0&&Date.parse(w.startedAt)<Date.parse(windows[i-1].expiresAt))||
    !windows.some(w=>Date.parse(w.startedAt)<=now&&now+60000<Date.parse(w.expiresAt))||observed>now||now-observed>86400000||
    b.maxSearchRequests>24||b.maxPageReads>20||b.maxModelRequests>6||b.maxSpendUsd>.30||b.maxNetworkRequests===undefined||b.maxNetworkRequests>640)throw Error('SHORTLIST_SCOPE_EXPIRED_OR_OVER_LIMIT');
  return scope;
}
