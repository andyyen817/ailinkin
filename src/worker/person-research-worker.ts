import 'server-only';
import {businessDb,identityDb} from '../server/db';import {authorizeTenant} from '../server/policy';import {campaign} from '../server/research-store';
import {persistContactReview} from '../server/contact-review-service';import {readPersonScope,personExecutionAllowed} from '../server/person-research-service';
import {advancePersonBatch,newPersonLease,reservePersonUsage} from '../server/person-research-runner';
import {personSourceCandidates,readPersonPublic} from '../server/person-research-public';import {extractSelectedPeople} from '../server/person-research-extraction';
import {namedApolloEnrichment} from '../server/person-research-apollo';import {putContactImage,readContactImage} from '../server/contact-evidence-store';
import {transport} from '../../scripts/research/http.mjs';import {langsearch} from '../../scripts/research/langsearch.mjs';
import type {PersonBatch} from '../domain/person-research';import fs from 'node:fs/promises';
import {databasePersonJournal} from '../server/person-research-ledger';import {executeStandardPersonStep,prepareStandardPersonStep} from '../server/person-standard-execution';
import {personPageOptions,personSearchQuery} from '../server/free-contact-followup-scope';
import {reuseOwnershipEmail} from '../server/free-email-ownership-scope';
import {alternativeProviderFetch} from '../server/free-contact-alternative-scope';
import {tombaHunterFetch} from '../server/free-tomba-scope';
import {prepareNewContactStep} from '../server/new-contact-batch-scope';
import {operatorWorkerTick} from '../server/operator-batch-worker';
async function tenantWork<T>(scope:any,work:(tx:any)=>Promise<T>):Promise<T>{
  const principal=await identityDb().user.findUnique({where:{id:scope.actorId}});if(!principal)throw Error('PERSON_ACTOR_UNAVAILABLE');
  return businessDb().$transaction(async tx=>{
    await tx.$executeRaw`SELECT set_config('app.user_id',${principal.id},true)`;await tx.$executeRaw`SELECT set_config('app.tenant_id',${scope.tenantId},true)`;
    const membership=await tx.membership.findUnique({where:{tenantId_userId:{tenantId:scope.tenantId,userId:principal.id}}}),tenant=await tx.tenant.findUnique({where:{id:scope.tenantId}});
    authorizeTenant({principal,tenant,membership,requestedTenantId:scope.tenantId,ownerOnly:true});return work(tx);
  });
}
export function existingVerifiedEmail(email:string,observations:any[],now=Date.now()){
  const key=email.toLowerCase(),prior=observations.findLast(o=>{const r=o.result,t=r?.technical;
    return r?.email?.toLowerCase()===key&&t?.email?.toLowerCase()===key&&t.provider==='hunter'&&t.status==='valid'&&!t.pending&&
      Number.isFinite(Date.parse(t.verifiedAt))&&Date.parse(t.verifiedAt)<=now&&Date.parse(t.expiresAt)>now;});
  return prior?{...structuredClone(prior.result),reusedFrom:prior.key,notice:'复用同一邮箱尚在有效期内的Hunter验证；人物归属仍需核对，未重复调用。'}:null;
}
export function workerCanClaim(batch:PersonBatch,now=Date.now()){
  const recovery=batch.state==='paused'&&!!batch.steps?.some(s=>s.state==='reserved');
  return (['queued','running'].includes(batch.state)||recovery)&&(!batch.lease||Date.parse(batch.lease.until)<=now);
}
export function personLeaseReleased(held:any,batch:any,token:string,release:boolean){
  if(release&&!held?.lease&&!batch.lease&&['paused','done','blocked'].includes(held?.state)&&held.state===batch.state)return true;
  if(held?.lease?.token!==token)throw Error('PERSON_WORKER_LEASE_LOST');
  return false;
}
export async function personWorkerTick(scope:any){
  if(scope.mode==='commercial')scope={...scope,journal:databasePersonJournal(scope,work=>tenantWork(scope,work))};
  for(const id of [...new Set(scope.people.map((p:any)=>p.campaignId))] as string[]){
    const claim:any=await tenantWork(scope,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.tenantId+':person-research:'+id}))`;
      const row=await campaign(tx,id);if(row.state==='running'||row.data.operatorLease||row.data.contactLease||row.data.contactBatchLease||row.data.apolloContactLease)return null;
      const batch:PersonBatch=row.data.personResearchBatches?.find((b:PersonBatch)=>workerCanClaim(b)&&personExecutionAllowed(row,b,scope));if(!batch)return null;
      batch.lease=newPersonLease();await persistContactReview(tx,row,scope.tenantId);row.version++;return {row,batch,token:batch.lease.token};
    });
    if(!claim)continue;
    const {row,batch,token}=claim;
    const save=async(release=false)=>tenantWork(scope,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.tenantId+':person-research:'+id}))`;
      const current=await campaign(tx,id),index=current.data.personResearchBatches.findIndex((b:any)=>b.id===batch.id),held=current.data.personResearchBatches[index];
      if(personLeaseReleased(held,batch,token,release))return;
      batch.pauseRequested||=held.pauseRequested;if(release)delete batch.lease;else if(batch.lease)batch.lease.until=new Date(Date.now()+180000).toISOString();
      current.data.personResearchBatches[index]=structuredClone(batch);
      const {applyPersonResearchResults}=await import('../server/person-research-results');applyPersonResearchResults(current,batch);
      await persistContactReview(tx,current,scope.tenantId);
    });
    const requests=batch.requests||=[];
    const ledger={requests,project:{maxRequests:100,maxSpendUsd:scope.limits.usd,maxApolloCredits:scope.limits.apollo}};
    const call=transport(ledger,{live:true,keys:{LANGSEARCH_API_KEY:process.env.LANGSEARCH_API_KEY,DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY,APOLLO_API_KEY:process.env.APOLLO_API_KEY},
      costUpperBound:{langsearch:0,ai:0.05,apollo:0},cacheSeconds:{langsearch:86400,ai:2592000,apollo:604800},
      lookupRequest:async(key:string)=>[...(row.data.requests||[]),...(row.data.personResearchBatches||[]).flatMap((b:any)=>b.requests||[])].find((r:any)=>r.key===key)},()=>save());
    const executePublic=async(step:any,person:any)=>{
      if(step.kind==='search'){const query=personSearchQuery(scope,step.input.query);if(query!==step.input.query)step.input.executedQuery=query;const result=personSourceCandidates(person,await langsearch(call,query,[],10,2000));call.commit();return result;}
      if(step.kind==='page'){
        let n=0;const options=personPageOptions(scope);if(options.maxImages)await reservePersonUsage(scope,batch.id+':'+step.id+':images',{images:options.maxImages});
        const page=await readPersonPublic(person,step.input.url,{...options,beforeRequest:()=>reservePersonUsage(scope,batch.id+':'+step.id+':network:'+ ++n,{network:1}).then(()=>{})});
        for(const image of page.images||[]){await putContactImage(scope.tenantId,image.bytes);delete image.bytes;}return page;
      }
      if(step.kind==='model'){
        const company=row.data.companies.find((c:any)=>c.id===step.input.companyId),people=batch.people.filter((p:any)=>step.input.personIds.includes(p.personId));
        const pages=batch.steps.filter((s:any)=>s.kind==='page'&&s.state==='done'&&people.some((p:any)=>p.personId===s.personId)).map((s:any)=>s.result);
        const result=await extractSelectedPeople(company,people,pages,call,row.data.personResearchExtractions||[],{loadImage:(imageId:string)=>readContactImage(scope.tenantId,imageId)});call.commit();return result;
      }
      const result=await namedApolloEnrichment(person,scope,call);call.commit();return result;
    };
    const context={scope,batch,call,save:()=>save(),executePublic,...(scope.batchType==='free_tomba'?{hunterFetcher:(input:RequestInfo|URL,init?:RequestInit)=>tombaHunterFetch(scope,input,init)}:{}),...(scope.batchType==='free_contact_alternative'?{finderFetcher:(input:RequestInfo|URL,init?:RequestInit)=>alternativeProviderFetch(scope,input,init)}:{}),previousObservations:(row.data.personResearchBatches||[]).flatMap((b:any)=>b.fieldObservations||[]),previousReceipts:(row.data.personResearchBatches||[]).flatMap((b:any)=>b.providerReceipts||[])};
    const executionScope={...scope,prepareStep:async(step:any,person:any)=>{const fresh=await prepareNewContactStep(scope,step,person);if(fresh)return fresh;const observations=[...context.previousObservations,...(batch.fieldObservations||[])],reused=reuseOwnershipEmail(scope,step,observations)||(scope.batchType==='free_contact_followup'&&step.kind==='verify'?existingVerifiedEmail(step.input.email,observations):null);
      if(reused)return {result:reused};const p=prepareStandardPersonStep(step,person,context);return 'result' in p?{result:p.result}:null;}};
    try{await advancePersonBatch(batch,executionScope,(step,person)=>batch.planVersion===2?executeStandardPersonStep(step,person,context):executePublic(step,person),()=>save());}finally{await save(true);}
    return true;
  }return false;
}
export async function runPersonWorker(durationMs=7200000){
  const {requireRuntime}=await import('../../scripts/runtime-guard.mjs');
  requireRuntime('worker');
  const deadline=Date.now()+durationMs;
  while(Date.now()<deadline){
    if(process.env.PERSON_WORKER_STOP_PATH)try{await fs.access(process.env.PERSON_WORKER_STOP_PATH);break;}catch{}
    const operated=process.env.OPERATOR_SELF_SERVICE_ENABLED!=='false'||process.env.OPERATOR_BATCH_SCOPE_PATH?await operatorWorkerTick():false;
    if(!operated&&!process.env.OPERATOR_BATCH_SCOPE_PATH){const scope=await readPersonScope();if(scope)await personWorkerTick(scope);}
    if(process.env.PERSON_WORKER_ONCE==='1')break;
    await new Promise(r=>setTimeout(r,1500));
  }
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/person-research-worker.ts'))runPersonWorker().catch(()=>{process.stderr.write('PERSON_WORKER_FAILED: inspect persisted batch and journal; no automatic external replay\n');process.exitCode=1;});
