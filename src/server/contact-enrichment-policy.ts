import 'server-only';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {traceGrantInput,traceLimitFields,seedTracePeople} from './contact-trace-policy';
const integer=(max:number)=>z.number().int().min(0).max(max);
export const enrichmentGrantInput=z.object({searches:integer(49),publicPages:integer(98),network:integer(200),finder:integer(49),verify:integer(20),prospeoCredits:integer(24),hunterCredits:z.number().min(0).max(10).multipleOf(0.5),minutes:z.number().int().min(5).max(60),consent:z.literal(true)}).strict();
export const anyEnrichmentGrant=z.union([enrichmentGrantInput,traceGrantInput]);
const stable=(value:any)=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const digest=(v:any)=>createHash('sha256').update(stable(v)).digest('hex');
export function savedEnrichmentPeople(row:any,sourceBatchId:string){
  const source=row.data.operatorBatches?.find((b:any)=>b.id===sourceBatchId);
  if(!source?.selfService||source.state!=='done'||!source.people?.length||source.people.length>49)throw Error('ENRICHMENT_SAVED_BATCH_REQUIRED');
  const people=source.people.map((p:any)=>({personKey:p.personKey,companyId:p.companyId,companyName:p.companyName,campaignId:p.campaignId,name:p.name,title:p.title||'',domain:p.domain,profileUrl:p.profileUrl,sourcePersonId:p.sourcePersonId,prospeoId:p.prospeoId}));
  if(people.some((p:any)=>p.campaignId!==row.id||!p.name||!p.profileUrl||!row.data.companies.some((c:any)=>c.id===p.companyId))||new Set(people.map((p:any)=>p.personKey)).size!==people.length)throw Error('ENRICHMENT_COHORT_INVALID');
  return people;
}
export function makeEnrichmentGrant(row:any,actorId:string,sourceBatchId:string,raw:unknown,now=Date.now()){
  const input:any=anyEnrichmentGrant.parse(raw),saved=savedEnrichmentPeople(row,sourceBatchId),people=input.method==='trace_v2'?seedTracePeople(saved,row.data.operatorBatches,input.hints):saved;
  if(!row.data.operatorDirection||row.tenant_id!==row.data.project.tenantId)throw Error('ENRICHMENT_TENANT_DENIED');
  if(row.data.operatorBatches.some((b:any)=>!['done','blocked'].includes(b.state)))throw Error('OPERATOR_ACTIVE_BATCH_EXISTS');
  return {id:randomUUID(),selfService:true,mode:'people_enrichment',tenantId:row.tenant_id,actorId,anchorCampaignId:row.id,enabled:true,
    sourceBatchId,traceMethod:input.method,peopleHash:digest(people),people,targets:[...new Map(people.map((p:any)=>[p.companyId,{companyId:p.companyId,campaignId:row.id,name:p.companyName,domain:p.domain}])).values()],
    direction:structuredClone(row.data.operatorDirection),approvedAt:new Date(now).toISOString(),notAfter:new Date(now+input.minutes*60000).toISOString(),
    limits:{pages:0,companies:0,locations:0,accounts:4,searches:input.searches,publicPages:input.publicPages,network:input.network,finder:input.finder,verify:input.verify,...traceLimitFields(input)},
    credits:{prospeo:input.prospeoCredits,hunter:input.hunterCredits},approvalEvidence:{kind:'authenticated_owner_enrichment',actorId,input,consent:true},
    cash:0,send:false,purchase:false,phoneReveal:false,register:false};
}
export function assertEnrichmentGrant(scope:any){
  const proof=scope.approvalEvidence,input:any=anyEnrichmentGrant.parse(proof?.input);
  if(scope.mode!=='people_enrichment'||proof.kind!=='authenticated_owner_enrichment'||proof.actorId!==scope.actorId||digest(scope.people)!==scope.peopleHash)throw Error('ENRICHMENT_GRANT_CHANGED');
  if(scope.traceMethod!==input.method)throw Error('ENRICHMENT_GRANT_CHANGED');
  const expected={pages:0,companies:0,locations:0,accounts:4,searches:input.searches,publicPages:input.publicPages,network:input.network,finder:input.finder,verify:input.verify,...traceLimitFields(input)};
  if(stable(expected)!==stable(scope.limits)||scope.credits.prospeo!==input.prospeoCredits||scope.credits.hunter!==input.hunterCredits||Date.parse(scope.notAfter)-Date.parse(scope.approvedAt)!==input.minutes*60000)throw Error('ENRICHMENT_GRANT_CHANGED');
}
export function enrichmentBatch(scope:any){
  assertEnrichmentGrant(scope);
  return {id:randomUUID(),scopeId:scope.id,selfService:true,mode:scope.mode,traceMethod:scope.traceMethod,sourceBatchId:scope.sourceBatchId,actorId:scope.actorId,state:'checking',stage:'public',
    createdAt:new Date().toISOString(),localExpiresAt:scope.notAfter,direction:scope.direction,targets:structuredClone(scope.targets),creditLimits:scope.credits,limits:structuredClone(scope.limits),
    receipts:[],people:scope.people.map((p:any)=>({...p,selected:false,status:'等待补全',reason:'等待核实免费来源',...(!scope.traceMethod?{otherAccounts:[],ownershipEvidence:[]}:{})})),events:[{at:new Date().toISOString(),message:'已保存原联系人名单及补全限额，未采集新人。'}],failures:0,sent:0,cash:0};
}
export function executableEnrichmentLimits(batch:any){
  const free=(provider:string)=>/^free$/i.test(batch.accounts?.[provider]?.plan||'')?Math.max(0,Number(batch.accounts[provider].remaining)||0):0;
  return {...batch.limits,pages:0,finder:Math.min(batch.limits.finder,batch.people.length,free('prospeo')>=1&&batch.creditLimits.prospeo>=1?(batch.dailyLimit?.remaining??Infinity):0),verify:Math.min(batch.limits.verify,Math.floor(Math.min(free('hunter'),batch.creditLimits.hunter)*2)),
    searches:batch.publicQualification?.free===true?batch.limits.searches:0};
}
