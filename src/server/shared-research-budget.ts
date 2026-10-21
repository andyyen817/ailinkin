import 'server-only';
import type {Prisma} from '@/generated/prisma/client';
import {sharedResearchBudget,reserveSharedLedger} from '@/domain/shared-research-budget';
import {analysisRow} from './company-analysis-store';
import {withTenant} from './tenant';
import {AccessError} from './policy';
import {checkedAlternativeScope} from '@/domain/shortlist-alternative';
import {recoverPreflightLedger} from '@/domain/shortlist-preflight';
import {campaign} from './research-store';
export async function reserveSharedBudget(tx:Prisma.TransactionClient,tenantId:string,raw:unknown,item:{service:string;requestKey:string;reservedCost:number},scope?:any){
  const limits=sharedResearchBudget.parse(raw);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':shared-research:'+limits.analysisId}))`;
  const row=await analysisRow(tx,limits.analysisId);if(row.tenant_id!==tenantId)throw new AccessError('ANALYSIS_NOT_FOUND',404);
  const previous=JSON.stringify(row.data),data=row.data as any,budgets=data.sharedResearchBudgets||[];
  if(!budgets.some((b:any)=>b.id===limits.id)&&budgets.length>=100)throw Error('SHARED_BUDGET_HISTORY_LIMIT');
  const prior=budgets.find((b:any)=>b.id===limits.id);let next;
  if(scope?.continuation&&item.service==='apollo'){
    const candidates=await Promise.all(scope.campaignIds.map((id:string)=>campaign(tx,id)));
    const owner=candidates.find((c:any)=>c.data.requests.some((q:any)=>q.key===item.requestKey));
    if(!owner)throw Error('PREFLIGHT_OWNER_NOT_FOUND');checkedAlternativeScope(scope,owner);
    const proof=owner.data.requests.filter((q:any)=>q.key===item.requestKey).at(-1);
    next=recoverPreflightLedger(prior,limits,item,proof,scope);
  }else next=reserveSharedLedger(prior,limits,item);
  data.sharedResearchBudgets=[...budgets.filter((b:any)=>b.id!==limits.id),next];
  const n=await tx.$executeRaw`UPDATE company_analysis SET data=${JSON.stringify(data)}::jsonb WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version} AND data=${previous}::jsonb`;
  if(n!==1)throw new AccessError('SHARED_BUDGET_VERSION_CONFLICT',409);return next;
}
export function sharedBudgetGuard(request:Request,tenantId:string,scope:any,analysisId:string){
  if(!scope?.sharedBudget)return undefined;
  const limits=sharedResearchBudget.parse(scope.sharedBudget);
  if(limits.analysisId!==analysisId||Date.parse(limits.expiresAt)>Date.parse(scope.expiresAt))throw Error('SHARED_BUDGET_SCOPE_MISMATCH');
  return (item:{service:string;requestKey:string;reservedCost:number})=>{
    if(scope.continuation&&!['apollo','ai','public_web','public_network'].includes(item.service))throw Error('CONTINUATION_SOURCE_NOT_APPROVED');
    return withTenant(request,tenantId,tx=>reserveSharedBudget(tx,tenantId,limits,item,scope),true);
  };
}
