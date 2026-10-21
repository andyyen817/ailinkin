import 'server-only';
import {z} from 'zod';
import {campaign} from './research-store';
import {AccessError} from './policy';
import {persistContactReview} from './contact-review-service';
import {readOperatorScope,operatorRows,operatorView,saveOperatorAction,operatorInput} from './operator-batch-service';
import {freeGrantInput,makeSelfServiceGrant,selfServiceBatch} from './operator-selfservice-policy';
import {assertOperatorScope,changeOperatorBatch,nextOperatorPage,publicOperatorBatch} from './operator-batch-policy';
import {savedOperatorDaily} from './operator-saved-people';
import {buildOperatorExport} from './operator-batch-export';
import {anyEnrichmentGrant,makeEnrichmentGrant,enrichmentBatch} from './contact-enrichment-policy';
export const pageOperatorInput=z.union([operatorInput,z.object({campaignId:z.uuid(),action:z.literal('authorize_enrichment'),sourceBatchId:z.uuid(),grant:anyEnrichmentGrant}).strict(),z.object({campaignId:z.uuid(),action:z.literal('authorize'),grant:freeGrantInput}).strict(),
  z.object({campaignId:z.uuid(),batchId:z.uuid(),action:z.literal('select'),companyIds:z.array(z.string().min(1).max(160)).max(10)}).strict()]);
export async function pageOperatorContext(tx:any,tenantId:string,id:string,batchId?:string,narrow=false){
  const row=await campaign(tx,id);
  if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);
  if(!row.data.operatorDirection){const scope=await readOperatorScope();return {row,scope,rows:await operatorRows(tx,scope,tenantId),selfService:false};}
  const scopes=row.data.operatorScopes||[],batch=batchId?row.data.operatorBatches?.find((b:any)=>b.id===batchId):null;
  const scope=batchId?scopes.find((s:any)=>s.id===batch?.scopeId):scopes.at(-1);
  if(batchId&&!scope)throw new AccessError('OPERATOR_BATCH_DENIED',404);
  if(narrow)return {row,scope,rows:[row],selfService:true};
  const rows=await tx.$queryRaw`SELECT id,tenant_id,version,state,data FROM research_campaign WHERE tenant_id=${tenantId} ORDER BY created_at DESC LIMIT 101`;
  if(rows.length>100)throw new AccessError('OPERATOR_HISTORY_REVIEW_REQUIRED',409);
  const anchor=rows.find((r:any)=>r.id===id);if(!anchor)throw new AccessError('SEARCH_NOT_FOUND',404);
  return {row:anchor,scope:scope?anchor.data.operatorScopes?.find((s:any)=>s.id===scope.id):undefined,rows,selfService:true};
}
export function pageOperatorView(context:any):any{
  if(!context.selfService)return operatorView(context.rows,context.scope);
  const {row,scope}=context,batches=row.data.operatorBatches||[];
  return {selfService:true,direction:row.data.operatorDirection,scopeId:scope?.id,mode:'direction',
    available:!!scope&&Date.parse(scope.notAfter)>Date.now(),limits:scope?.limits||{pages:0,finder:0,verify:0,accounts:0},
    credits:scope?.credits,companies:[],usage:{accounts:0},batches:batches.map(publicOperatorBatch),
    grantHistory:(row.data.operatorScopes||[]).map((s:any)=>({id:s.id,approvedAt:s.approvedAt,notAfter:s.notAfter,limits:s.limits,credits:s.credits}))};
}
export function selectDirectionCompanies(context:any,batch:any,ids:string[]){
  const {row,scope,rows}=context;
  if(batch.state!=='selecting'||batch.lease)throw Error('OPERATOR_NOT_READY');
  if(new Set(ids).size!==ids.length||ids.length>batch.limits.pages)throw Error('OPERATOR_LIMIT_INVALID');
  const targets=ids.map(id=>{
    const c=batch.companyChoices.find((c:any)=>c.id===id);
    if(!c)throw Error('OPERATOR_COMPANY_DENIED');
    return {companyId:id,campaignId:row.id,name:c.name,domain:c.domain,page:nextOperatorPage(rows,id)};
  });
  scope.targets=targets;scope.discoverTargets=targets;batch.targets=structuredClone(targets);
  batch.stage=targets.length?'pages':'after';batch.state='running';
  batch.events.push({at:new Date().toISOString(),message:`已选择${targets.length}家企业，按已确认限额继续。`});
}
export async function pageOperatorAction(tx:any,tenantId:string,actorId:string,input:any){
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':operator-batch'}))`;
  const context=await pageOperatorContext(tx,tenantId,input.campaignId,input.batchId,['pause','resume','confirm','refresh_export'].includes(input.action));
  if(!context.selfService){if(['authorize','select'].includes(input.action))throw new AccessError('OPERATOR_DIRECTION_REQUIRED',409);return saveOperatorAction(tx,context.scope,tenantId,actorId,input);}
  const {row}=context;
  if(input.action==='authorize_enrichment'){
    const active=row.data.operatorBatches?.find((b:any)=>!['done','blocked'].includes(b.state));if(active)return {...pageOperatorView(context),reused:true};
    const scope=makeEnrichmentGrant(row,actorId,input.sourceBatchId,input.grant),batch:any=enrichmentBatch(scope);batch.dailyLimit=savedOperatorDaily(context.rows);
    row.data.operatorScopes.push(scope);row.data.operatorBatches.push(batch);context.scope=scope;
  }else if(input.action==='authorize'){
    const active=row.data.operatorBatches?.find((b:any)=>!['done','blocked'].includes(b.state));
    if(active)return {...pageOperatorView(context),reused:true};
    const scope=makeSelfServiceGrant(row,actorId,input.grant),batch:any=selfServiceBatch(scope);
    batch.dailyLimit=savedOperatorDaily(context.rows);
    (row.data.operatorScopes||=[]).push(scope);(row.data.operatorBatches||=[]).push(batch);context.scope=scope;
  }else{
    const batch=row.data.operatorBatches?.find((b:any)=>b.id===input.batchId);
    if(!batch||batch.actorId!==actorId||!context.scope||batch.scopeId!==context.scope.id)throw new AccessError('OPERATOR_BATCH_DENIED',403);
    if(!['pause','refresh_export'].includes(input.action))assertOperatorScope(context.scope,tenantId,actorId);
    if(input.action==='select')selectDirectionCompanies(context,batch,input.companyIds);
    else changeOperatorBatch(batch,input.action);
    if(input.action==='refresh_export'){
      batch.export=await buildOperatorExport(context.rows,context.scope,batch);batch.state='done';batch.finishedAt=new Date().toISOString();
      batch.events.push({at:batch.finishedAt,message:'已使用保存资料更新总表；未启动采集或调用外部来源。'});
    }
  }
  await persistContactReview(tx,row,tenantId);return pageOperatorView(context);
}
