import 'server-only';
import type {Prisma} from '@/generated/prisma/client';
import {AccessError} from './policy';
import {scopeLinks} from './search-scope-store';
import {marketKey} from '@/domain/target-markets';
export {marketKey} from '@/domain/target-markets';

export type History = {id: string; state: string; project: any; companies: any[];attempts?:any[];sourcePages?:any[];sourcePipeline?:any;discoveryReferences?:any[]};
type Group = {semanticKey: string; market: string; relatedCampaignIds?: string[];application?:string;role?:string;searchSpecs?:any[]};
function sameScope(a:Group,b:Group|undefined){
  const normal=(s:string)=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  const x=a.searchSpecs?.[0],y=b?.searchSpecs?.[0];
  return Boolean(a.application&&a.role&&b?.application&&b.role&&x?.direction&&x?.marketMode&&y&&
    normal(a.application)===normal(b.application)&&normal(a.role)===normal(b.role)&&
    x.direction===y.direction&&x.marketMode===y.marketMode&&marketKey(a.market)===marketKey(b.market));
}
export async function searchHistory(tx: Prisma.TransactionClient, tenantId: string) {
  const rows=await tx.$queryRaw<History[]>`SELECT id,state,data->'project' AS project,
    COALESCE(data->'companies','[]'::jsonb) AS companies,COALESCE(data->'attempts','[]'::jsonb) AS attempts,
    COALESCE(data->'sourcePages','[]'::jsonb) AS "sourcePages",data->'sourcePipeline' AS "sourcePipeline",
    COALESCE(data->'discoveryReferences','[]'::jsonb) AS "discoveryReferences" FROM research_campaign
    WHERE tenant_id=${tenantId} ORDER BY created_at DESC`;
  const links=await scopeLinks(tx,tenantId);
  for(const row of rows){
    const scope=row.project?.buyerGroup;
    if(scope)scope.relatedSemanticKeys=links.flatMap(l=>l.left_key===scope.semanticKey?[l.right_key]:l.right_key===scope.semanticKey?[l.left_key]:[]);
  }
  return rows;
}
// Only explicit links and identical structured scopes connect groups. Similar words alone are insufficient.
export function resolveHistory(group: Group, histories: History[], selected: string[] = []) {
  const available = histories.filter(h => marketKey(h.project.country || '') === marketKey(group.market));
  const ids = new Set([...selected, ...(group.relatedCampaignIds || [])]);
  if ([...ids].some(id => !available.some(h => h.id === id))) throw new AccessError('HISTORY_SCOPE_UNAVAILABLE', 409);
  const keys = new Set([group.semanticKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const history of available) {
      const scope = history.project.buyerGroup;
      const links: string[] = scope?.relatedCampaignIds || [];
      const relatedKeys:string[]=scope?.relatedSemanticKeys||[];
      if (!ids.has(history.id) && !keys.has(scope?.semanticKey) && !sameScope(group,scope) && !relatedKeys.some(k=>keys.has(k)) && !links.some(id => ids.has(id))) continue;
      if (!ids.has(history.id)) {ids.add(history.id); changed = true;}
      if (scope?.semanticKey && !keys.has(scope.semanticKey)) {keys.add(scope.semanticKey); changed = true;}
      for (const id of links) {
        if (!available.some(h => h.id === id)) throw new AccessError('HISTORY_SCOPE_UNAVAILABLE', 409);
        if (!ids.has(id)) {ids.add(id); changed = true;}
      }
    }
  }
  return available.filter(h => ids.has(h.id));
}
export function historyChoices(group: Group, histories: History[], related: History[]) {
  const known = new Set(related.map(h => h.id));
  return histories.filter(h => marketKey(h.project.country || '') === marketKey(group.market)).map(h => ({
    id: h.id, label: h.project.buyerGroup?.label || h.project.product,
    country: h.project.country, provider: h.project.discoveryProvider === 'apollo' ? 'Apollo' : '网页搜索',
    companyCount: h.companies.length, related: known.has(h.id),
  }));
}
