import 'server-only';
import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import type {PersonBatch,PersonBudget,PersonStep} from '@/domain/person-research';import {personHash} from './person-research-selection';
import {relevantPersonText} from './person-research-plan';
import {qualifiedSource,personStepSource} from './contact-source-policy';
import {personPageResult} from './person-research-public';
import {limitPersonFields} from './person-public-extraction';
const empty=():PersonBudget=>({searches:0,pages:0,network:0,images:0,models:0,usd:0,apollo:0});
export async function personJournal(scope:any,work:(j:any)=>any){
  if(scope.journal)return scope.journal(work);
  if(!/^[\w-]{1,100}$/.test(scope.id))throw Error('PERSON_SCOPE_ID_INVALID');
  const folder=path.resolve('.runtime/person-research-journals');await fs.mkdir(folder,{recursive:true});
  const file=path.join(folder,scope.id+'.json'),lock=file+'.lock';let handle;
  for(let n=0;n<100;n++){try{handle=await fs.open(lock,'wx');await handle.writeFile(JSON.stringify({pid:process.pid}));break;}catch(e){if((e as any).code!=='EEXIST')throw e;
    try{const held=JSON.parse(await fs.readFile(lock,'utf8'));try{process.kill(held.pid,0);}catch(dead){if((dead as any).code==='ESRCH'){await fs.unlink(lock);continue;}}}catch{}
    await new Promise(r=>setTimeout(r,25));}}
  if(!handle)throw Error('PERSON_BUDGET_BUSY');
  try{let j;try{j=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if((e as any).code!=='ENOENT')throw e;j={scopeId:scope.id,usage:empty(),operations:{}};}
    const result=await work(j),temp=file+'.'+process.pid+'.tmp';await fs.writeFile(temp,JSON.stringify(j),'utf8');await fs.rename(temp,file);return result;
  }finally{await handle.close();await fs.unlink(lock);}
}
export function renewPersonJournalClock(j:any,scope:any,now=Date.now()){
  if(!j.startedAt||now<Date.parse(j.expiresAt))return false;
  const renewed=Date.parse(scope.renewedAt),end=Date.parse(scope.notAfter);
  if(!scope.enabled||!scope.renewalEvidence||!Number.isFinite(renewed)||renewed>now||renewed<=Date.parse(j.expiresAt)||end<=now||end>renewed+(scope.batchType==='free_tomba'&&scope.tombaApprovalEvidence?100*60000:3600000))return false;
  (j.renewalHistory||=[]).push({priorExpiresAt:j.expiresAt,renewedAt:scope.renewedAt,evidence:scope.renewalEvidence});j.expiresAt=scope.notAfter;return true;
}
function reserveUsage(j:any,scope:any,key:string,amount:Partial<PersonBudget>){
    const now=Date.now();if(!scope.enabled||now>=Date.parse(scope.notAfter))throw Error('PERSON_SCOPE_EXPIRED');
    if(j.startedAt&&now>=Date.parse(j.expiresAt)&&!renewPersonJournalClock(j,scope,now))throw Error('PERSON_SCOPE_EXPIRED');
    if(j.reservations?.[key])return false;
    for(const [kind,n] of Object.entries(amount))if(!Number.isFinite(n)||n!<0||!Number.isFinite(scope.limits[kind])||Number(((j.usage[kind]||0)+n!).toFixed(8))>scope.limits[kind])throw Error('PERSON_BUDGET_EXHAUSTED:'+kind);
    j.startedAt||=new Date(now).toISOString();j.expiresAt||=new Date(Math.min(now+(scope.minutes||60)*60000,Date.parse(scope.notAfter))).toISOString();
    for(const [kind,n] of Object.entries(amount))j.usage[kind]=Number(((j.usage[kind]||0)+n!).toFixed(8));
    (j.reservations||={})[key]={amount,at:new Date(now).toISOString()};return true;
}
export async function reservePersonUsage(scope:any,key:string,amount:Partial<PersonBudget>){
  return personJournal(scope,j=>reserveUsage(j,scope,key,amount));
}
export async function journalledPersonStep(scope:any,key:string,amount:Partial<PersonBudget>,execute:()=>Promise<any>,continuePending=false){
  const previous=await personJournal(scope,j=>{
    const old=j.operations[key],poll=continuePending&&old?.state==='done'&&(old.result?.technical?.pending||old.result?.state==='provider_pending');
    if(old?.state==='done'&&!poll)return old;
    if(old&&!poll)throw Error('PERSON_PREVIOUS_RESULT_UNKNOWN_OR_FAILED');
    if(poll&&(old.pollRounds||0)>=2)throw Error('EMAIL_VERIFICATION_POLL_LIMIT');
    if(!scope.enabled||Date.now()>=Date.parse(scope.notAfter))throw Error('PERSON_SCOPE_EXPIRED');
    if(!poll){if(j.reservations?.[key])throw Error('PERSON_RESERVATION_REQUIRES_RECONCILIATION');reserveUsage(j,scope,key,amount);}
    j.operations[key]={...old,state:'reserved',startedAt:new Date().toISOString(),pollRounds:(old?.pollRounds||0)+(poll?1:0)};
    return null;
  });
  if(previous)return {result:previous.result,reused:true};
  try{const result=await execute();await personJournal(scope,j=>{j.operations[key]={...j.operations[key],state:'done',result,finishedAt:new Date().toISOString()};});return {result,reused:false};}
  catch(e){await personJournal(scope,j=>{j.operations[key]={...j.operations[key],state:(e as any).status&&(e as any).status!=='待核实'?'failed':'unknown',error:(e as Error).message.slice(0,500)};});throw e;}
}
function followupStep(personId:string,kind:PersonStep['kind'],input:any):PersonStep{return {id:'PST-'+personHash([personId,kind,input]).slice(0,24),personId,kind,input,state:'pending'};}
export async function advancePersonBatch(batch:PersonBatch,scope:any,execute:(step:PersonStep,person:any)=>Promise<any>,save:()=>Promise<void>){
  if(batch.state==='done')return;
  if(batch.planVersion===2)for(const failed of batch.steps.filter(s=>s.state==='failed'&&/HTTP.?[_ ]?429|Rate limit/i.test(s.error||'')))(batch.sourceStates||={})[failed.input.sourceId]=failed.error!;
  let step=batch.steps.find(s=>s.state==='reserved');
  if(step){const receipt=await personJournal(scope,j=>j.operations[batch.id+':'+step!.id]);
    if(receipt?.state==='done'){step.result=receipt.result;step.state='done';await save();return;}
    batch.usage=await personJournal(scope,j=>{const operation=j.operations[batch.id+':'+step!.id];
      if(operation?.state==='reserved')Object.assign(operation,{state:'unknown',error:'Previous worker ended without a response receipt',reconciledAt:new Date().toISOString()});return j.usage;});
    for(const request of (batch as any).requests||[])if(request.status==='pending'){request.status='unknown';request.reconciledAt=new Date().toISOString();}
    step.state='unknown';batch.state=batch.planVersion===2?'running':'blocked';batch.notice='上次步骤结果未知，停止重发，保留原始记录。';await save();return;}
  if(batch.state==='paused'||batch.state==='blocked')return;
  if(batch.pauseRequested){batch.state='paused';delete batch.lease;await save();return;}
  if(Date.now()>=Date.parse(batch.expiresAt||scope.notAfter)){batch.state='blocked';batch.notice='授权时间已到，已保存进度。';await save();return;}
  batch.state='running';
  step=batch.steps.find(s=>s.state==='pending');
  if(!step){
    const companies=[...new Set(batch.people.map(p=>p.companyId))];
    for(const companyId of companies){const people=batch.people.filter(p=>p.companyId===companyId),pages=batch.steps.filter(s=>s.kind==='page'&&s.state==='done'&&people.some(p=>p.personId===s.personId)&&people.some(p=>relevantPersonText(p.name,p.companyName,(s.result?.blocks||[]).map((b:any)=>b.text).join('\n'))));
      const fields=[...new Set(people.flatMap(p=>p.fields))] as string[],model=qualifiedSource(scope,'deepseek','analysis',fields);
      const transferable=pages.every(s=>(scope.sources||[]).find((v:any)=>v.id===s.input.sourceId)?.modelTransfer===true);
      if(pages.length&&(batch.planVersion!==2||model?.modelTransfer&&transferable)&&!batch.steps.some(s=>s.kind==='model'&&s.input.companyId===companyId))batch.steps.push(followupStep(people[0].personId,'model',{companyId,personIds:people.map(p=>p.personId),fields,...(model?{sourceId:model.id}:{})}));}
    if(batch.planVersion!==2&&scope.apolloEligibility?.eligible)for(const p of batch.people)if(p.fields.includes('work_email')&&!batch.steps.some(s=>s.kind==='apollo'&&s.personId===p.personId)&&!batch.steps.filter(s=>s.kind==='model').some(s=>s.result?.people?.some((v:any)=>v.name===p.name&&v.contacts?.some((c:any)=>c.kind==='email'&&c.scope==='person'))))batch.steps.push(followupStep(p.personId,'apollo',{}));
    step=batch.steps.find(s=>s.state==='pending');
    if(!step){const waiting=batch.steps.some(s=>s.state==='done'&&(s.kind==='verify'&&s.result?.technical?.pending||s.kind==='finder'&&s.result?.state==='provider_pending'));
      batch.state=batch.steps.some(s=>s.state==='unknown')?'blocked':waiting?'paused':'done';
      batch.notice=batch.state==='blocked'?'独立步骤已完成；未知操作仍待核对，未重发。':waiting?'其他独立步骤已结束；原邮箱操作仍在等待，保留原记录，未自动重查。':'本批有限来源已执行；未找到的字段已记录，继续保留给销售判断。';delete batch.lease;await save();return;}
  }
  const person=batch.people.find(p=>p.personId===step!.personId),key=batch.id+':'+step.id;
  const source=batch.planVersion===2?personStepSource(scope,step,person):null;
  if(batch.planVersion===2&&(!source||batch.sourceStates?.[step.input.sourceId])){step.state='skipped';step.error='来源未获准、字段无资格或本端点已停用；未发送也未预留额度';await save();return;}
  let cached:any=null;
  if(batch.planVersion===2){
    if(step.kind==='finder'&&scope.providerComparison!==true&&batch.steps.some(s=>s.state==='done'&&s.personId===person.personId&&s.result?.people?.some((p:any)=>p.contacts?.some((c:any)=>c.kind==='email'&&c.scope==='person')))){step.state='skipped';step.error='已取得邮箱候选，继续核实，不再购买';await save();return;}
    if(step.kind==='page'){
      const shared=batch.steps.find(s=>s!==step&&s.kind==='page'&&s.input.url===step!.input.url&&batch.people.find(p=>p.personId===s.personId)?.companyId===person.companyId&&s.state==='done'&&s.result?.blocks?.length);
      if(shared)cached={result:{...limitPersonFields(personPageResult(person,shared.result),step.input.fields||person.fields),reused:true,reusedFrom:shared.id}};
      if(batch.steps.some(s=>s!==step&&s.kind==='page'&&s.input.url===step!.input.url&&['unknown','reserved'].includes(s.state))){step.state='skipped';step.error='相同URL已有待核对操作，未再次读取';await save();return;}
    }
    try{cached||=await scope.prepareStep?.(step,person);}catch(e){step.state='skipped';step.error=(e as Error).message;await save();return;}
  }
  const amount:Partial<PersonBudget>=step.kind==='search'?{searches:1}:step.kind==='page'?{pages:1}:step.kind==='model'?{models:1,usd:0.05}:step.kind==='finder'?{finder:1,usd:source?.maxCostUsd??0}:step.kind==='verify'?{verifications:1,usd:source?.maxCostUsd??0}:step.kind==='discover'?{}:{apollo:1};
  if(!cached){step.state='reserved';step.startedAt=new Date().toISOString();await save();}
  try{
    const response=cached?{result:cached.result,reused:true}:await journalledPersonStep(scope,key,amount,async()=>{batch.usage=await personJournal(scope,j=>j.usage);await save();return execute(step!,person);},['verify','finder'].includes(step.kind)&&step.input.continuation===true);step.result=response.result;step.reused=!!response.reused;step.state='done';step.finishedAt=new Date().toISOString();
    if(step.kind==='search'){
      const seen=batch.steps.filter(s=>s.kind==='page'&&s.personId===step!.personId).map(s=>s.input.url),remaining=Math.max(0,2-seen.length);
      const urls=(response.result||[]).filter((r:any)=>r.admitted&&!seen.includes(r.url)).slice(0,remaining).map((r:any)=>r.url);
      const pages=urls.map((url:string)=>{const next=followupStep(person.personId,'page',{url,...(batch.planVersion===2?{sourceId:qualifiedSource(scope,'public','page',person.fields)?.id||'',fields:person.fields}:{})});
        const shared=batch.steps.find(s=>s.kind==='page'&&s.state==='done'&&s.input.url===url&&batch.people.find(p=>p.personId===s.personId)?.companyId===person.companyId);
        if(shared){next.state='done';next.result={...personPageResult(person,shared.result),reused:true,reusedFrom:shared.id};next.finishedAt=shared.finishedAt;}return next;});
      batch.steps.splice(batch.steps.indexOf(step)+1,0,...pages);
    }
    if(batch.planVersion===2){
      if(step.kind==='discover'&&response.result?.nextPage&&step.input.page<(scope.maxDiscoveryPages||1))batch.steps.push(followupStep(person.personId,'discover',{...step.input,page:response.result.nextPage}));
      if(scope.batchType!=='free_tomba'&&step.kind==='page'&&(step.input.depth||0)<2)for(const url of response.result?.personLinks||[])if(!batch.steps.some(s=>s.kind==='page'&&s.input.url===url))batch.steps.push(followupStep(person.personId,'page',{url,depth:(step.input.depth||0)+1,sourceId:step.input.sourceId}));
      const verifier=qualifiedSource(scope,'hunter','/v2/email-verifier');
      if(verifier?.fields?.includes('work_email'))for(const found of response.result?.people||[])for(const c of found.contacts||[])if(c.kind==='email'&&c.scope==='person'&&!batch.steps.some(s=>s.kind==='verify'&&s.input.email.toLowerCase()===c.value.toLowerCase()))batch.steps.push(followupStep(scope.batchType==='free_tomba'&&batch.people.some(p=>p.personId===found.personId)?found.personId:person.personId,'verify',{email:c.value.toLowerCase(),sourceId:verifier.id,fields:['work_email']}));
    }
    const journal=await personJournal(scope,j=>({usage:j.usage,expiresAt:j.expiresAt}));batch.usage=journal.usage;batch.expiresAt=journal.expiresAt||batch.expiresAt;
    if(step.kind==='verify'&&step.result?.technical?.pending)batch.notice='此邮箱验证仍在等待，原操作已保存；继续其他人物的独立步骤，不自动重查。';
    person.state=step.kind==='model'||step.kind==='apollo'?'results_ready':'partial';await save();
  }catch(e){
    const receipt=await personJournal(scope,j=>j.operations[key]);
    if(receipt?.state==='done'){step.result=receipt.result;step.state='done';throw e;}
    step.error=(e as Error).message.slice(0,500);step.state=receipt?.state==='unknown'?'unknown':'failed';
    if(batch.planVersion===2){
      if(/HTTP.?[_ ]?(401|403|429)|Rate limit|权限|qualification/i.test(step.error))(batch.sourceStates||={})[step.input.sourceId]=step.error;
      batch.state='running';batch.notice='此步骤已隔离；其他独立来源继续，失败及未知不重发。';
    }else{batch.state='blocked';batch.notice=step.error;}await save();
  }
}
export const newPersonLease=()=>({token:randomUUID(),until:new Date(Date.now()+180000).toISOString()});
