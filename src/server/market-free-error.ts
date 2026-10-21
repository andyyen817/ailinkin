import type {marketScope} from '@/domain/market-research';
import type {z} from 'zod';
export function approvedFreeSearchFailure(request:any,scope:z.infer<typeof marketScope>|null|undefined){
  return !!scope && scope.enabled && Date.parse(scope.approvedAt)<=Date.now() && Date.now()<Date.parse(scope.expiresAt) &&
    scope.continueFreeSearchFailureIds?.includes(request.id) && request.scopeId===scope.id && request.status==='unknown' &&
    request.service==='langsearch' && request.route==='/v1/web-search' && request.httpStatus===502 &&
    request.reservedCost===0 && request.reservedCredits===0 && request.response==null;
}
export function hasBlockingMarketRequest(requests:any[],scope:z.infer<typeof marketScope>|null|undefined){
  return requests.some(r=>['unknown','pending'].includes(r.status)&&!approvedFreeSearchFailure(r,scope));
}
