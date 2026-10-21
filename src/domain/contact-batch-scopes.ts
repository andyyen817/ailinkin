import {z} from 'zod';
import {contactBatchScope} from './contact-batch';

const scopeSet=z.object({scopes:z.array(contactBatchScope).min(1).max(20)}).strict();
export function resolveContactBatchScope(raw:unknown,campaignId?:string){
  if(!raw||typeof raw!=='object')throw Error('CONTACT_SCOPE_INVALID');
  if(!('scopes' in raw)){
    const scope=contactBatchScope.parse(raw);
    return !campaignId||scope.campaignId===campaignId?scope:null;
  }
  const {scopes}=scopeSet.parse(raw),first=scopes[0];
  if(new Set(scopes.map(s=>s.campaignId)).size!==scopes.length||
    new Set(scopes.map(s=>s.id)).size!==scopes.length||
    scopes.some(s=>s.tenantId!==first.tenantId||s.approvedAt!==first.approvedAt||s.expiresAt!==first.expiresAt||
      JSON.stringify(s.sharedBudget)!==JSON.stringify(first.sharedBudget)))throw Error('CONTACT_SHARED_SCOPE_MISMATCH');
  return scopes.find(s=>s.campaignId===campaignId)||null;
}
