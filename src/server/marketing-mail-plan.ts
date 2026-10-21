import 'server-only';
import {createHash} from 'node:crypto';
import type {Campaign} from '@/domain/research';
import {marketingInput,type MarketingInput} from '@/domain/marketing-mail';
import {contactMailHandoff} from './contact-review-handoff';
import {reviewView} from './contact-review-service';
import {AccessError} from './policy';
export const mailDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value)).digest('hex');
export function marketingRecipientSuppressed(row:Campaign,email:string){return (row.data.marketingPlans||[]).some((p:any)=>p.messages.some((m:any)=>m.email.toLowerCase()===email.toLowerCase()&&m.optOut));}
export function marketingPlanValid(row:Campaign,plan:any){
  const handoff=contactMailHandoff(row);return !!handoff&&!handoff.superseded&&handoff.id===plan.handoffId&&handoff.draftBasis===plan.draftBasis&&
    plan.basis===mailDigest([plan.handoffId,plan.draftBasis,plan.sender,plan.messages.map((m:any)=>({rowId:m.rowId,email:m.email,scope:m.scope,subject:m.subject,body:m.body,followups:m.followups})),plan.maxFollowups])&&
    plan.messages.every((m:any)=>!marketingRecipientSuppressed(row,m.email)&&!row.data.companies.find((c:any)=>c.id===m.companyId)?.doNotContact&&reviewView(row).rows.some(r=>r.id===m.rowId&&!r.doNotContact));
}
export function prepareMarketingPlan(row:Campaign,tenantId:string,actorId:string,raw:unknown,now=new Date().toISOString()){
  const input=marketingInput.parse(raw);if(input.action!=='prepare')throw new AccessError('INVALID_INPUT',400);
  if(row.tenant_id!==tenantId||row.id!==input.campaignId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);
  if(row.state==='running'||row.data.contactBatchLease)throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
  const handoff=contactMailHandoff(row);if(!handoff||handoff.superseded||handoff.id!==input.handoffId)throw new AccessError('CONTACT_REVIEW_CONFIRMATION_REQUIRED',409);
  if(new Set(input.messages.map(m=>m.rowId)).size!==input.messages.length)throw new AccessError('DUPLICATE_RECIPIENT',400);
  const messages=input.messages.map(m=>{
    const chosen=handoff.recipients.find((r:any)=>r.rowId===m.rowId);if(!chosen)throw new AccessError('RECIPIENT_NOT_SELECTED',409);
    if(/\[(?:your|company|sender)[^\]]*\]/i.test(m.body))throw new AccessError('SENDER_PLACEHOLDER_REQUIRES_REVIEW',409);
    const company=row.data.companies.find((c:any)=>c.id===chosen.companyId),record=reviewView(row).rows.find(r=>r.id===m.rowId);
    if(company?.doNotContact||record?.doNotContact||marketingRecipientSuppressed(row,chosen.email))throw new AccessError('RECIPIENT_SUPPRESSED',409);
    const followups=Array.from({length:input.maxFollowups},(_,i)=>({subject:'Re: '+m.subject,body:`Hello ${company?.name||'your'} team,\n\n${i?'This is our final follow-up.':'I wanted to follow up on our enquiry.'} If another team handles this, could you point us to the appropriate contact? If this is not relevant, please let us know and we will stop following up.\n\n${input.sender.name}\n${input.sender.company}`}));
    return {...m,email:chosen.email,companyId:chosen.companyId,scope:chosen.scope,evidence:chosen.evidence,followups,state:'draft',deliveries:[],verification:null,replies:[]};
  });
  const basis=mailDigest([handoff.id,handoff.draftBasis,input.sender,messages.map(m=>({rowId:m.rowId,email:m.email,scope:m.scope,subject:m.subject,body:m.body,followups:m.followups})),input.maxFollowups]),id='MP-'+basis.slice(0,24);
  const old=(row.data.marketingPlans||[]).find((p:any)=>p.id===id);if(old)return {plan:old,reused:true,sent:0};
  if((row.data.marketingPlans||[]).length>=100)throw new AccessError('MARKETING_HISTORY_LIMIT',409);
  const plan={id,basis,handoffId:handoff.id,draftBasis:handoff.draftBasis,sender:input.sender,maxFollowups:input.maxFollowups,messages,actorId,createdAt:now,confirmation:null,state:'draft'};
  (row.data.marketingPlans||=[]).push(plan);return {plan,reused:false,sent:0};
}
export function confirmMarketingPlan(row:Campaign,tenantId:string,actorId:string,input:Exclude<MarketingInput,{action:'prepare'}>){
  if(row.tenant_id!==tenantId||row.id!==input.campaignId)throw new AccessError('SEARCH_NOT_FOUND',404);
  const plan=row.data.marketingPlans?.find((p:any)=>p.id===input.planId);if(!plan||plan.basis!==input.expectedBasis||!marketingPlanValid(row,plan))throw new AccessError('MARKETING_PLAN_STALE',409);
  const reused=!!plan.confirmation;if(!reused){plan.confirmation={actorId,basis:plan.basis,confirmedAt:new Date().toISOString()};plan.state='confirmed';}
  return {plan,reused,sent:0};
}
