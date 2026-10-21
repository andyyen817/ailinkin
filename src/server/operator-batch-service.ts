import 'server-only';
import fs from 'node:fs/promises';
import {z} from 'zod';
import {campaign} from './research-store';
import {persistContactReview} from './contact-review-service';
import {AccessError} from './policy';
import {assertOperatorScope,makeOperatorBatch,changeOperatorBatch,publicOperatorBatch,operatorUsage} from './operator-batch-policy';
import {savedUnqueriedPeople} from './operator-saved-people';
export const operatorInput=z.object({campaignId:z.uuid(),action:z.enum(['create','confirm','pause','resume','refresh_export']),batchId:z.uuid().optional(),companyIds:z.array(z.string().min(1).max(160)).min(1).max(2).optional(),finder:z.number().int().min(0).max(73).optional(),verify:z.number().int().min(0).max(2).optional()}).strict();
export async function readOperatorScope(){
  try{return JSON.parse(await fs.readFile(/* turbopackIgnore: true */process.env.OPERATOR_BATCH_SCOPE_PATH||'.runtime/no-operator-scope','utf8'));}catch{return null;}
}
export async function operatorRows(tx:any,scope:any,tenantId:string){
  if(!scope||scope.tenantId!==tenantId)throw new AccessError('OPERATOR_SCOPE_UNAVAILABLE',403);
  const ids=[...new Set([scope.anchorCampaignId,...scope.targets.map((t:any)=>t.campaignId)])] as string[],rows=[];
  for(const id of ids){const row=await campaign(tx,id);if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);rows.push(row);}return rows;
}
export function operatorView(rows:any[],scope:any){
  const anchor=rows.find(r=>r.id===scope.anchorCampaignId),batches=anchor.data.operatorBatches||[];
  const saved=scope.mode==='saved_unqueried',people=saved?savedUnqueriedPeople(rows,scope):[],targets=saved?scope.targets.filter((t:any)=>people.some(p=>p.companyId===t.companyId)):scope.discoverTargets;
  return {scopeId:scope.id,mode:scope.mode,unqueriedCount:people.length,credits:scope.credits,available:Date.parse(scope.notAfter)>Date.now(),notAfter:scope.notAfter,limits:scope.limits,usage:operatorUsage(batches,scope.id),companies:targets.map((t:any)=>({id:t.companyId,name:rows.find(r=>r.id===t.campaignId)?.data.companies.find((c:any)=>c.id===t.companyId)?.name||t.companyId})),batches:batches.map(publicOperatorBatch),notice:'仅使用已确认的免费余额。发送0封；查不到记录原因继续。'};
}
export function applyOperatorAction(rows:any[],scope:any,tenantId:string,actorId:string,input:any){
  const row=rows.find(r=>r.id===scope.anchorCampaignId);if(!row||!rows.some(r=>r.id===input.campaignId))throw Error('OPERATOR_CAMPAIGN_DENIED');
  if(input.action==='create'){
    const result=makeOperatorBatch(scope,rows,input,actorId);
    if(!result.reused){result.batch.localExpiresAt=scope.notAfter;(row.data.operatorBatches||=[]).push(result.batch);}return {changed:!result.reused,batch:result.batch};
  }
  const batch=row.data.operatorBatches?.find((b:any)=>b.id===input.batchId);
  if(!batch||batch.actorId!==actorId||scope.tenantId!==tenantId)throw Error('OPERATOR_BATCH_DENIED');
  if(!['pause','refresh_export'].includes(input.action))assertOperatorScope(scope,tenantId,actorId);
  if(batch.scopeId!==scope.id)throw Error('OPERATOR_GRANT_CHANGED');
  return {batch,changed:changeOperatorBatch(batch,input.action)};
}
export async function saveOperatorAction(tx:any,scope:any,tenantId:string,actorId:string,input:any){
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':operator-batch'}))`;
  const rows=await operatorRows(tx,scope,tenantId),result=applyOperatorAction(rows,scope,tenantId,actorId,input);
  if(result.changed)await persistContactReview(tx,rows.find(r=>r.id===scope.anchorCampaignId)!,tenantId);
  return {...operatorView(rows,scope),reused:!result.changed};
}
