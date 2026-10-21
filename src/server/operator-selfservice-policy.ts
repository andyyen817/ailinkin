import 'server-only';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {emptyLedger} from '../../scripts/research/schema.mjs';
import {assertEnrichmentGrant} from './contact-enrichment-policy';
const text=z.string().trim().min(1).max(200);
const stable=(value:any)=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const directionInput=z.object({
  name:text,product:text,country:text,customerType:text,
  keywords:z.array(z.string().trim().min(3).max(100)).min(1).max(20),
  roles:z.array(z.string().trim().min(2).max(100)).max(20).default([]),
}).strict();
export const freeGrantInput=z.object({
  pages:z.number().int().min(1).max(10),finder:z.number().int().min(0).max(100),
  verify:z.number().int().min(0).max(20),prospeoCredits:z.number().int().min(1).max(100),
  hunterCredits:z.number().min(0).max(10).multipleOf(0.5),minutes:z.number().int().min(5).max(60),
  consent:z.literal(true),
}).strict();
export function directionData(raw:unknown,tenantId:string){
  const input=directionInput.parse(raw);
  return {...emptyLedger({tenantId,product:input.product,country:input.country,keywords:input.keywords,
    target:25,maxRequests:0,maxSpendUsd:0}),operatorDirection:{...input,marketMode:'headquarters',createdAt:new Date().toISOString()}};
}
export function makeSelfServiceGrant(row:any,actorId:string,raw:unknown,now=Date.now()){
  const input=freeGrantInput.parse(raw);
  if(!row.data.operatorDirection||row.data.project.tenantId!==row.tenant_id)throw Error('OPERATOR_DIRECTION_REQUIRED');
  if(row.data.operatorBatches?.some((b:any)=>!['done','blocked'].includes(b.state)))throw Error('OPERATOR_ACTIVE_BATCH_EXISTS');
  return {id:randomUUID(),selfService:true,mode:'direction',tenantId:row.tenant_id,actorId,
    anchorCampaignId:row.id,targets:[],discoverTargets:[],enabled:true,
    approvedAt:new Date(now).toISOString(),notAfter:new Date(now+input.minutes*60000).toISOString(),
    approvalEvidence:{kind:'authenticated_owner_page',actorId,consent:true,input},
    directionHash:createHash('sha256').update(stable(row.data.operatorDirection)).digest('hex'),
    direction:structuredClone(row.data.operatorDirection),
    limits:{companies:1,locations:1,pages:input.pages,finder:input.finder,verify:input.verify,accounts:4},
    credits:{prospeo:input.prospeoCredits,hunter:input.hunterCredits},
    cash:0,send:false,purchase:false,phoneReveal:false,register:false};
}
export function assertSelfServiceGrant(scope:any){
  if(scope.mode==='people_enrichment'){assertEnrichmentGrant(scope);return true;}
  const proof=scope.approvalEvidence;
  if(scope.mode!=='direction'||!proof||proof.kind!=='authenticated_owner_page'||proof.actorId!==scope.actorId)throw Error('OPERATOR_PAGE_GRANT_REQUIRED');
  const input=freeGrantInput.parse(proof.input);
  const expected={companies:1,locations:1,pages:input.pages,finder:input.finder,verify:input.verify,accounts:4};
  if(stable(scope.limits)!==stable(expected)||scope.credits?.prospeo!==input.prospeoCredits||scope.credits?.hunter!==input.hunterCredits)throw Error('OPERATOR_PAGE_GRANT_CHANGED');
  if(Date.parse(scope.notAfter)-Date.parse(scope.approvedAt)!==input.minutes*60000)throw Error('OPERATOR_PAGE_GRANT_CHANGED');
  if(createHash('sha256').update(stable(scope.direction)).digest('hex')!==scope.directionHash)throw Error('OPERATOR_DIRECTION_CHANGED');
  return true;
}
export function selfServiceBatch(scope:any){
  assertSelfServiceGrant(scope);
  return {id:randomUUID(),scopeId:scope.id,selfService:true,mode:'direction',actorId:scope.actorId,
    state:'checking',stage:'companies',createdAt:new Date().toISOString(),localExpiresAt:scope.notAfter,
    creditLimits:scope.credits,limits:structuredClone(scope.limits),targets:[],receipts:[],people:[],
    direction:structuredClone(scope.direction),failures:0,sent:0,cash:0,
    events:[{at:new Date().toISOString(),message:'页面限额已保存，正在核实实际免费余额。'}]};
}
