import 'server-only';
import {randomUUID} from 'node:crypto';
import {businessDb,identityDb} from './db';
import {authorizeTenant} from './policy';
import {persistContactReview} from './contact-review-service';
import {operatorRows,readOperatorScope} from './operator-batch-service';
import {advanceOperatorBatch} from './operator-batch-runner';
import {executeOperatorOperation,applyOperatorOperation} from './operator-batch-provider';
import {buildOperatorExport} from './operator-batch-export';
import {reconcileOperatorReceipts} from './operator-receipt-recovery';
import {pageOperatorContext} from './operator-selfservice-service';
import {nextPersistedOperatorScope,writableOperatorRows} from './operator-persisted-jobs';
export function operatorClaimable(batch:any,at=Date.now()){
  return ['checking','running','exporting'].includes(batch.state)&&(!batch.lease||Date.parse(batch.lease.until)<=at);
}
async function work<T>(scope:any,fn:(tx:any)=>Promise<T>){
  const principal=await identityDb().user.findUnique({where:{id:scope.actorId}});if(!principal)throw Error('OPERATOR_ACTOR_UNAVAILABLE');
  return businessDb().$transaction(async tx=>{
    await tx.$executeRaw`SELECT set_config('app.user_id',${principal.id},true)`;await tx.$executeRaw`SELECT set_config('app.tenant_id',${scope.tenantId},true)`;
    const membership=await tx.membership.findUnique({where:{tenantId_userId:{tenantId:scope.tenantId,userId:principal.id}}}),tenant=await tx.tenant.findUnique({where:{id:scope.tenantId}});
    authorizeTenant({principal,tenant,membership,requestedTenantId:scope.tenantId,ownerOnly:true});
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.tenantId+':operator-batch'}))`;return fn(tx);
  },{timeout:15000,maxWait:5000});
}
export function mergeOperatorProjection(current:any,held:any,batch:any){
  const ids=new Set(batch.receipts.map((r:any)=>'CPR-OP-'+r.id)),runs=current.data.contactResearchRuns||=[];
  for(const run of held.data.contactResearchRuns||[])if(ids.has(run.id)){const i=runs.findIndex((r:any)=>r.id===run.id);if(i<0)runs.push(run);else runs[i]=run;}
  const attempts=current.data.operatorContactAttempts||=[];
  for(const p of batch.people.filter((p:any)=>p.campaignId===current.id)){
    const value={...p,batchId:batch.id,updatedAt:new Date().toISOString()},i=attempts.findIndex((a:any)=>a.personKey===p.personKey);if(i<0)attempts.push(value);else attempts[i]=value;
  }
  const completions=current.data.contactBatchCompletions||=[];
  for(const c of held.data.contactBatchCompletions||[])if(c.operatorBatchId===batch.id&&!completions.some((v:any)=>v.id===c.id))completions.push(c);
}
export async function reloadOperatorRows(tx:any,scope:any,load:any){
  if(!scope.selfService)return load(tx);
  const rows=await tx.$queryRaw`SELECT id,tenant_id,version,state,data FROM research_campaign WHERE id=${scope.anchorCampaignId} AND tenant_id=${scope.tenantId}`;
  if(rows.length!==1||rows[0].tenant_id!==scope.tenantId||rows[0].data.project.tenantId!==scope.tenantId)throw Error('OPERATOR_SAVE_TENANT_DENIED');
  return rows;
}
export async function operatorWorkerTick(){
  const scope=await nextPersistedOperatorScope(work)||await readOperatorScope();if(!scope)return false;
  const loadRows=async(tx:any)=>scope.selfService?(await pageOperatorContext(tx,scope.tenantId,scope.anchorCampaignId)).rows:operatorRows(tx,scope,scope.tenantId);
  const token=randomUUID(),claim:any=await work(scope,async tx=>{
    const rows=await loadRows(tx),anchor=rows.find((r:any)=>r.id===scope.anchorCampaignId)!;
    const batch=anchor.data.operatorBatches?.find((b:any)=>b.scopeId===scope.id&&operatorClaimable(b));if(!batch)return null;
    if(rows.some((r:any)=>r.state==='running'||r.data.contactLease||r.data.contactBatchLease||r.data.companyPathLease||r.data.browserContactLease||r.data.apolloContactLease||r.data.operatorLease&&Date.parse(r.data.operatorLease.until)>Date.now()))return null;
    batch.lease={token,until:new Date(Date.now()+180000).toISOString()};
    for(const row of writableOperatorRows(rows,scope)){row.data.operatorLease={...batch.lease,batchId:batch.id};await persistContactReview(tx,row,scope.tenantId);}return {rows,batch};
  });
  if(!claim)return false;
  const {rows,batch}=claim;
  const save=async(release=false)=>work(scope,async tx=>{
    const fresh=await reloadOperatorRows(tx,scope,loadRows),anchor=fresh.find((r:any)=>r.id===scope.anchorCampaignId)!,heldBatch=anchor.data.operatorBatches.find((b:any)=>b.id===batch.id);
    if(heldBatch?.lease?.token!==token)throw Error('OPERATOR_LEASE_LOST');
    batch.pauseRequested||=heldBatch.pauseRequested;
    if(release)delete batch.lease;else batch.lease.until=new Date(Date.now()+180000).toISOString();
    anchor.data.operatorBatches[anchor.data.operatorBatches.findIndex((b:any)=>b.id===batch.id)]=structuredClone(batch);
    for(const row of writableOperatorRows(fresh,scope)){
      if(row.data.operatorLease?.token!==token)throw Error('OPERATOR_LEASE_LOST');
      const held=rows.find((r:any)=>r.id===row.id);
      if(scope.selfService){row.data.companies=structuredClone(held.data.companies);}
      mergeOperatorProjection(row,held,batch);
      if(release)delete row.data.operatorLease;else row.data.operatorLease={...batch.lease,batchId:batch.id};
      await persistContactReview(tx,row,scope.tenantId);
    }
  });
  try{if(reconcileOperatorReceipts(batch,rows))await save();await advanceOperatorBatch(batch,scope,rows,(op:any,record:any)=>executeOperatorOperation(op,batch,record),(op:any)=>applyOperatorOperation(batch,rows,op),()=>save(),()=>buildOperatorExport(rows,scope,batch));}
  finally{await save(true);}return true;
}
