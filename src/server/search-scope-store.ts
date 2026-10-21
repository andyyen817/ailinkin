import 'server-only';
import {randomUUID,createHash} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import {AccessError} from './policy';
const normal=(s:string)=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export function scopeSignature(group:any){
  const spec=group.searchSpecs?.[0];
  if(!spec||!['buys_from_us','refers_orders','operates_our_brand'].includes(spec.direction))return null;
  return createHash('sha256').update(JSON.stringify([spec.direction,normal(group.application),
    normal(group.role),normal(group.market),spec.marketMode,group.searchSpecs.map((q:any)=>normal(q.business)).sort()])).digest('hex');
}
export async function saveSearchScope(tx:Prisma.TransactionClient,tenantId:string,group:any){
  const signature=scopeSignature(group);
  if(!signature||!group.analysisId||!group.analysisVersion)throw new AccessError('SEARCH_SCOPE_NOT_READY',409);
  const facets=JSON.stringify({signature,market:group.market,role:group.role,application:group.application,
    direction:group.searchSpecs[0].direction,marketMode:group.searchSpecs[0].marketMode});
  await tx.$executeRaw`INSERT INTO search_scope(id,tenant_id,scope_key,facets,analysis_id,analysis_version)
    VALUES(${randomUUID()},${tenantId},${group.semanticKey},${facets}::jsonb,${group.analysisId},${group.analysisVersion})
    ON CONFLICT(tenant_id,scope_key) DO NOTHING`;
  const [scope]=await tx.$queryRaw<{id:string}[]>`SELECT id FROM search_scope WHERE tenant_id=${tenantId} AND scope_key=${group.semanticKey}`;
  if(!scope)throw new AccessError('SEARCH_SCOPE_NOT_AVAILABLE',404);return scope.id;
}
export async function confirmScopeRelation(tx:Prisma.TransactionClient,tenantId:string,left:string,right:string,reason:string){
  if(left===right||!reason.trim())throw new AccessError('SCOPE_RELATION_INVALID',400);
  const rows=await tx.$queryRaw<any[]>`SELECT id,facets FROM search_scope WHERE tenant_id=${tenantId} AND id IN (${left},${right})`;
  if(rows.length!==2||normal(rows[0].facets.market)!==normal(rows[1].facets.market)||
    rows[0].facets.direction!==rows[1].facets.direction)throw new AccessError('SCOPE_RELATION_UNAVAILABLE',409);
  await tx.$executeRaw`INSERT INTO scope_relation(tenant_id,left_scope,right_scope,reason,verified)
    VALUES(${tenantId},${left},${right},${reason.trim()},true) ON CONFLICT(tenant_id,left_scope,right_scope)
    DO UPDATE SET reason=EXCLUDED.reason,verified=true`;
}
export async function scopeLinks(tx:Prisma.TransactionClient,tenantId:string){
  const [exists]=await tx.$queryRaw<{name:string|null}[]>`SELECT to_regclass('public.scope_relation')::text AS name`;
  if(!exists?.name)return [];
  return tx.$queryRaw<{left_key:string;right_key:string}[]>`SELECT a.scope_key left_key,b.scope_key right_key
    FROM search_scope a JOIN search_scope b ON a.tenant_id=b.tenant_id AND a.id<>b.id
    LEFT JOIN scope_relation r ON r.tenant_id=a.tenant_id AND r.left_scope=a.id AND r.right_scope=b.id
    WHERE a.tenant_id=${tenantId} AND (r.verified OR
      (a.facets->>'signature'=b.facets->>'signature' AND a.facets->>'signature' IS NOT NULL))`;
}
