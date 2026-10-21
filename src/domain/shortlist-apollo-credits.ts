import {checkedAlternativeScope} from './shortlist-alternative';
import {sharedResearchBudget} from './shared-research-budget';
export function scopedApolloCredits(raw:unknown,row:any,budget:any,others:any[],now=Date.now()){
 const s=checkedAlternativeScope(raw,row,now);
 if(!budget||JSON.stringify(sharedResearchBudget.parse(budget.limits))!==JSON.stringify(s.sharedBudget))throw Error('APOLLO_SHARED_SCOPE_MISMATCH');
 const reservations=budget.reservations.filter((r:any)=>r.service==='apollo');
 if(reservations.length>3)throw Error('APOLLO_SCOPED_CREDIT_LIMIT');
 const requests=[row,...others.filter(r=>r.id!==row.id)].flatMap(r=>{
  if(r.tenant_id!==s.tenantId||!s.campaignIds.includes(r.id))throw Error('APOLLO_CAMPAIGN_SCOPE_MISMATCH');
  return r.data.requests.filter((q:any)=>q.service==='apollo'&&Date.parse(q.startedAt)>=Date.parse(s.approvedAt));
 });
 for(const q of requests){
  if(q.route!=='/api/v1/mixed_companies/search'||(q.enrichmentPeople||0)>0||Date.parse(q.startedAt)>=Date.parse(s.expiresAt)||!reservations.some((r:any)=>r.requestKey===q.key))throw Error('APOLLO_REQUEST_SCOPE_MISMATCH');
 }
 const used=requests.reduce((n:number,q:any)=>n+(q.reservedCredits||0),0);
 if(used>3)throw Error('APOLLO_SCOPED_CREDIT_LIMIT');
 return used;
}
