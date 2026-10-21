import 'server-only';
import {campaign} from './research-store';import {persistContactReview} from './contact-review-service';
// Uses the existing campaign JSON and the existing tenant transaction, without schema creation.
export function databasePersonJournal(scope:any,transaction:(work:(tx:any)=>Promise<any>)=>Promise<any>){
  return async(work:(journal:any)=>any)=>transaction(async tx=>{
    const id=scope.journalCampaignId;if(!id||!scope.people.some((p:any)=>p.campaignId===id))throw Error('JOURNAL_CAMPAIGN_NOT_IN_SCOPE');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.tenantId+':person-journal:'+scope.id}))`;
    const row=await campaign(tx,id);if(row.tenant_id!==scope.tenantId)throw Error('JOURNAL_TENANT_MISMATCH');
    const journals=row.data.personBudgetJournals||={},j=journals[scope.id]||{scopeId:scope.id,usage:{searches:0,pages:0,network:0,images:0,models:0,usd:0,apollo:0,finder:0,verifications:0},operations:{}};
    const result=await work(j);journals[scope.id]=j;row.data.personBudgetJournals=journals;
    await persistContactReview(tx,row,scope.tenantId);return result;
  });
}
export function reusableFieldObservation(list:any[],key:string,tenantId:string,sourceId:string,now=Date.now()){
  return list.findLast(r=>r.key===key&&r.tenantId===tenantId&&r.sourceId===sourceId&&['done','not_found'].includes(r.state)&&Date.parse(r.expiresAt)>now);
}
export function recordFieldObservation(list:any[],entry:any){
  if(!entry.tenantId||!entry.sourceId||!entry.key||!entry.expiresAt)throw Error('FIELD_OBSERVATION_SCOPE_REQUIRED');
  const old=list.find(r=>r.key===entry.key&&r.tenantId===entry.tenantId&&r.sourceId===entry.sourceId);
  if(old&&['unknown','reserved'].includes(old.state))throw Error('FIELD_OBSERVATION_UNRESOLVED');
  list.push(structuredClone(entry));
}
