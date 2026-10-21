import {createHash} from 'node:crypto';import {sharedResearchBudget} from './shared-research-budget';
export function recoverPreflightLedger(previous:any,raw:unknown,item:any,proof:any,scope:any,now=Date.now()){
 const limits=sharedResearchBudget.parse(raw),fingerprint=createHash('sha256').update(JSON.stringify(limits)).digest('hex');
 if(!scope.continuation||Date.parse(limits.expiresAt)<=now||previous?.fingerprint!==fingerprint||item.service!=='apollo'||item.reservedCost!==0||!scope.continuation.preflightKeys.includes(item.requestKey))throw Error('PREFLIGHT_RECOVERY_SCOPE_REQUIRED');
 if(proof?.service!=='apollo'||proof.key!==item.requestKey||proof.status!=='blocked_before_send'||proof.reservedCredits!==0||proof.httpStatus!==undefined||proof.response!==undefined||proof.route!=='/api/v1/mixed_companies/search')throw Error('PREFLIGHT_NOT_PROVEN_UNSENT');
 const next=structuredClone(previous),slot=next.reservations.find((r:any)=>r.service==='apollo'&&r.requestKey===item.requestKey);
 if(!slot||slot.recoveries?.length)throw Error('PREFLIGHT_ALREADY_RESUMED_OR_MISSING');
 slot.recoveries=[{priorRequestId:proof.id,scopeExpiresAt:scope.expiresAt,reservedAt:new Date(now).toISOString(),state:'resume_reserved'}];
 return next;
}
