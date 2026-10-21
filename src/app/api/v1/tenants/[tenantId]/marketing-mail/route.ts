import {z} from 'zod';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {withTenant} from '@/server/tenant';
import {campaign} from '@/server/research-store';
import {json,failure,mutationOrigin} from '@/server/http';
import {AccessError} from '@/server/policy';
import {marketingInput,marketingScope} from '@/domain/marketing-mail';
import {prepareMarketingPlan,confirmMarketingPlan,marketingPlanValid} from '@/server/marketing-mail-plan';
import {checkMarketingScope,verifyMarketingAddresses,sendMarketingOne,updateMarketingReplies} from '@/server/marketing-mail-execution';
import {readMarketingConnection,hunterVerify,smtpMarketingSend,gmailReplies} from '@/server/marketing-mail-transport';
import {persistContactReview} from '@/server/contact-review-service';
export const runtime='nodejs';export const maxDuration=180;type Context={params:Promise<{tenantId:string}>};
async function scopeFor(){try{return marketingScope.parse(JSON.parse(await fs.readFile(/* turbopackIgnore: true */ process.env.MARKETING_SCOPE_PATH||'.runtime/marketing-scope.json','utf8')));}catch{return null;}}
function enabled(row:any,plan:any,scope:any){try{checkMarketingScope(row,plan,scope);return true;}catch{return false;}}
export async function GET(request:Request,{params}:Context){
  try{const {tenantId}=await params,id=z.uuid().parse(new URL(request.url).searchParams.get('campaignId')),scope=await scopeFor(),connection=await readMarketingConnection(tenantId);
    return json(await withTenant(request,tenantId,async tx=>{const row=await campaign(tx,id);
      if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);
      return {plans:(row.data.marketingPlans||[]).map((p:any)=>({...p,valid:marketingPlanValid(row,p),scopeEnabled:enabled(row,p,scope)})),
        connection:{configured:!!connection,email:connection?.email||'',verifyEnabled:process.env.MARKETING_VERIFY_ENABLED==='true'&&!!process.env.HUNTER_API_KEY,
          sendEnabled:process.env.MARKETING_SEND_ENABLED==='true'&&!!connection,replyEnabled:process.env.MARKETING_REPLY_ENABLED==='true'&&!!connection?.gmailTokenEnv&&!!process.env[connection.gmailTokenEnv]},sent:(row.data.marketingPlans||[]).flatMap((p:any)=>p.messages).flatMap((m:any)=>m.deliveries).filter((d:any)=>d.state==='accepted').length};
    }));
  }catch(e){return failure(e);}
}
export async function POST(request:Request,{params}:Context){
  try{mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
    let size=0;const chunks:Uint8Array[]=[];try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>524288){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(p.value);}}finally{reader.releaseLock();}
    const input=marketingInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))),scope=await scopeFor(),connection=await readMarketingConnection(tenantId),token=randomUUID();
    const result=await withTenant(request,tenantId,async(tx,actor)=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':marketing:'+input.campaignId}))`;const row=await campaign(tx,input.campaignId);
      if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);
      if(row.state==='running'||row.data.marketingLease)throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
      if(input.action==='prepare'){const p=prepareMarketingPlan(row,tenantId,actor.userId,input);if(!p.reused)await persistContactReview(tx,row,tenantId);return {local:true,result:p};}
      if(input.action==='confirm'){const p=confirmMarketingPlan(row,tenantId,actor.userId,input);if(!p.reused)await persistContactReview(tx,row,tenantId);return {local:true,result:p};}
      const plan=row.data.marketingPlans?.find((p:any)=>p.id===input.planId);
      if(!plan||plan.basis!==input.expectedBasis||!enabled(row,plan,scope))throw new AccessError('MARKETING_SCOPE_REQUIRED',403);
      if(input.action==='verify'&&(process.env.MARKETING_VERIFY_ENABLED!=='true'||!process.env.HUNTER_API_KEY))throw new AccessError('VERIFICATION_NOT_CONNECTED',409);
      if(['send','followup'].includes(input.action)&&(process.env.MARKETING_SEND_ENABLED!=='true'||!connection||connection.email!==plan.sender.email))throw new AccessError('MARKETING_SENDER_NOT_CONNECTED',409);
      if(input.action==='check_replies'&&(process.env.MARKETING_REPLY_ENABLED!=='true'||!connection||!scope?.maxReplyReads||(plan.replyReads||0)>=scope.maxReplyReads))throw new AccessError('REPLY_MAILBOX_OR_BUDGET_REQUIRED',409);
      const priorState=row.state;row.data.marketingLease={token,until:new Date(Date.now()+180000).toISOString()};
      const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state='running',lease_token=${token},lease_until=now()+interval '3 minutes',version=version+1
        WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version}`;
      if(n!==1)throw new AccessError('SEARCH_VERSION_CONFLICT',409);row.version++;return {local:false,row,plan,priorState};
    },true);
    if(result.local)return json(result.result);
    const {row,plan,priorState}=result;
    if(!row||!plan||!priorState)throw new AccessError('MARKETING_PLAN_STALE',409);
    const save=async()=>withTenant(request,tenantId,async tx=>{const held=!!row.data.marketingLease;
      const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state=${held?'running':priorState},lease_token=${held?token:null},lease_until=${held?new Date(Date.now()+180000):null},version=version+1
        WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version} AND data->'marketingLease'->>'token'=${token}`;
      if(n!==1)throw new AccessError('MARKETING_CHECKPOINT_CONFLICT',409);row.version++;
    },true);
    try{if(input.action==='verify')await verifyMarketingAddresses(row,plan,scope,(email,key)=>hunterVerify(email,process.env.HUNTER_API_KEY!,key),save);
      else if(input.action==='check_replies'){
        const pending=plan.messages.filter((m:any)=>m.deliveries.some((d:any)=>d.state==='accepted')).sort((a:any,b:any)=>(a.replyCheckedAt||'').localeCompare(b.replyCheckedAt||''));
        for(const m of pending.slice(0,scope!.maxReplyReads-(plan.replyReads||0))){plan.replyReads=(plan.replyReads||0)+1;await save();
          await updateMarketingReplies({messages:[m]},id=>gmailReplies(connection!,id),save);m.replyCheckedAt=new Date().toISOString();await save();}
      }
      else await sendMarketingOne(row,plan,scope,message=>smtpMarketingSend(connection!,message),save,{followup:input.action==='followup'});
      delete row.data.marketingLease;await save();return json({plan,sent:plan.messages.flatMap((m:any)=>m.deliveries).filter((d:any)=>d.state==='accepted').length});
    }catch(e){delete row.data.marketingLease;await save().catch(()=>{});throw e;}
  }catch(e){return failure(e);}
}
