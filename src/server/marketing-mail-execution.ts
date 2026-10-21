import 'server-only';
import type {Campaign} from '@/domain/research';
import {marketingScope} from '@/domain/marketing-mail';
import {marketingPlanValid,mailDigest} from './marketing-mail-plan';
import {checkedVerification} from './email-verification';
export function checkMarketingScope(row:Campaign,plan:any,rawScope:unknown,now=Date.now()){
  const scope=marketingScope.parse(rawScope);
  if(scope.tenantId!==row.tenant_id||scope.campaignId!==row.id||scope.planId!==plan.id||scope.basis!==plan.basis||scope.senderEmail!==plan.sender.email||
    !plan.messages.every((m:any)=>scope.recipientEmails.includes(m.email))||Date.parse(scope.expiresAt)<=now||Date.parse(scope.approvedAt)>now)throw Error('MARKETING_SCOPE_REQUIRED');
  if(!plan.confirmation||plan.confirmation.basis!==plan.basis||!marketingPlanValid(row,plan))throw Error('MARKETING_PLAN_STALE');return scope;
}
export async function verifyMarketingAddresses(row:Campaign,plan:any,rawScope:unknown,verify:(email:string,key:string)=>Promise<any>,save:()=>Promise<void>,now=Date.now()){
  const scope=checkMarketingScope(row,plan,rawScope,now);let operations=(plan.verifications||[]).length;
  const cost=Number(process.env.HUNTER_VERIFICATION_COST_UPPER_USD);
  if(!Number.isFinite(cost)||cost<0)throw Error('VERIFICATION_COST_UPPER_BOUND_REQUIRED');
  for(const m of plan.messages){if(m.verification){try{checkedVerification(m.verification,m.email,now);continue;}catch{}}
    const key=mailDigest([plan.id,m.email]),old=(plan.verifications||[]).find((r:any)=>r.key===key);
    if(old?.state==='unknown'||old?.state==='pending')throw Error('VERIFICATION_UNKNOWN_NO_REPLAY');
    if(!old&&operations>=scope.maxVerifications)throw Error('VERIFICATION_BUDGET_REACHED');
    if(!old&&(plan.verifications||[]).reduce((n:number,r:any)=>n+(r.reservedUsd||0),0)+cost>scope.maxSpendUsd)throw Error('VERIFICATION_SPEND_REACHED');
    const request=old||{key,email:m.email,state:'pending',reservedUsd:cost,startedAt:new Date(now).toISOString()};if(!old){(plan.verifications||=[]).push(request);operations++;}request.state='pending';await save();
    try{const result=await verify(m.email,key);if(result.pending){request.state='provider_processing';await save();continue;}
      m.verification=checkedVerification(result,m.email,Math.max(now,Date.now()));request.state='done';request.result=m.verification.status;await save();
    }catch(e){request.state='unknown';await save();throw e;}
  }
}
export async function sendMarketingOne(row:Campaign,plan:any,rawScope:unknown,send:(message:any)=>Promise<any>,save:()=>Promise<void>,{now=Date.now(),followup=false}={}){
  const scope=checkMarketingScope(row,plan,rawScope,now),all=plan.messages.flatMap((m:any)=>m.deliveries);
  if(all.some((r:any)=>['pending','unknown'].includes(r.state)))throw Error('MAIL_RESULT_UNKNOWN_NO_REPLAY');
  const m=plan.messages.find((m:any)=>!m.replies.length&&!m.optOut&&(followup?m.deliveries.some((r:any)=>r.state==='accepted')&&m.deliveries.length<=plan.maxFollowups&&
    now-Date.parse(m.deliveries.at(-1).startedAt)>=3*86400000:m.deliveries.length===0));
  if(!m)return {reused:true,sent:0};
  if(all.length>=scope.maxMessages)throw Error('MAIL_SCOPE_COUNT_REACHED');
  if(checkedVerification(m.verification,m.email,now).status!=='valid')throw Error('EMAIL_NOT_VERIFIED');
  const sequence=m.deliveries.length,company=row.data.companies.find((c:any)=>c.id===m.companyId),messageId=`<${mailDigest([plan.id,m.rowId,sequence])}@${plan.sender.email.split('@')[1]}>`;
  const body=sequence?m.followups?.[sequence-1]?.body:m.body;if(!body)throw Error('FOLLOWUP_NOT_REVIEWED');
  const delivery={id:messageId,state:'pending',startedAt:new Date(now).toISOString(),sequence};m.deliveries.push(delivery);await save();
  try{const receipt=await send({...m,sender:plan.sender,body,subject:sequence?m.followups[sequence-1].subject:m.subject,messageId});if(!receipt.accepted)throw Error('MAIL_ACCEPTANCE_UNKNOWN');
    Object.assign(delivery,{state:'accepted',receipt});m.state='sent';await save();return {sent:1,reused:false};
  }catch(e){delivery.state='unknown';await save();throw e;}
}
export async function updateMarketingReplies(plan:any,read:(id:string)=>Promise<any[]>,save:()=>Promise<void>){
  for(const m of plan.messages){const first=m.deliveries.find((r:any)=>r.state==='accepted');if(!first)continue;
    const replies=await read(first.id);m.replies=[...new Map([...m.replies,...replies].map((r:any)=>[r.id,r])).values()];
    if(m.replies.length){m.state='replied';m.followupsStopped=true;if(m.replies.some((r:any)=>/unsubscribe|stop contacting|remove me|不要联系|退订/i.test(r.snippet||'')))m.optOut=true;}await save();
  }
}
