import {z} from 'zod';import {sharedResearchBudget} from './shared-research-budget';
export const alternativeScope=z.object({kind:z.literal('market-shortlist-source'),id:z.string().min(1),tenantId:z.uuid(),analysisId:z.uuid(),analysisVersion:z.number().int().positive(),campaignIds:z.array(z.uuid()).length(2),markets:z.array(z.string()).length(2),approvedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),sharedBudget:sharedResearchBudget,
  continuedUnknownFreeRequestIds:z.array(z.string()).max(10),allowedSources:z.union([z.tuple([z.literal('apollo'),z.literal('Google'),z.literal('Bing')]),z.tuple([z.literal('apollo')])]),authorizationEvidence:z.string().min(1),continuation:z.object({priorExpiresAt:z.iso.datetime(),preflightKeys:z.array(z.string().regex(/^[a-f0-9]{64}$/)).length(2)}).strict().optional()}).strict();
export function checkedAlternativeScope(raw:unknown,row:any,now=Date.now()){
 const s=alternativeScope.parse(raw),p=row.data.project,b=s.sharedBudget;
 if(s.tenantId!==row.tenant_id||p.tenantId!==s.tenantId||!s.campaignIds.includes(row.id)||new Set(s.campaignIds).size!==2||!s.markets.includes(p.country)||s.analysisId!==p.analysis?.id||s.analysisVersion!==p.analysis?.version||b.analysisId!==s.analysisId||b.expiresAt!==s.expiresAt||!p.buyerGroup?.ready)throw Error('SOURCE_SCOPE_MISMATCH');
 const c=s.continuation;
 const bounds=c?b.maxPageReads===28&&b.maxNetworkRequests===238&&b.maxModelRequests===7&&b.maxSpendUsd===.35&&b.maxBrowserSearchRequests===2&&s.allowedSources.length===1&&Date.parse(c.priorExpiresAt)<Date.parse(s.approvedAt)&&new Set(c.preflightKeys).size===2:b.maxPageReads===27&&b.maxNetworkRequests===292&&b.maxModelRequests===6&&b.maxSpendUsd===.30&&b.maxBrowserSearchRequests===4&&s.allowedSources.length===3;
 if(Date.parse(s.approvedAt)>now||now+60000>=Date.parse(s.expiresAt)||Date.parse(s.expiresAt)-Date.parse(s.approvedAt)>3600000||!bounds||b.maxSearchRequests!==24||b.maxApolloSearchRequests!==3||b.maxApolloAccessChecks!==1)throw Error('SOURCE_SCOPE_EXPIRED_OR_OVER_LIMIT');
 return s;
}
