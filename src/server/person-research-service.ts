import 'server-only';
import fs from 'node:fs/promises';
import type {Campaign} from '@/domain/research';import {personLimits,personResearchInput,type PersonBatch} from '@/domain/person-research';
import {personSelectionView,savePersonSelection} from './person-research-selection';import {personResearchPlan} from './person-research-plan';import {AccessError} from './policy';
import {standardPersonPlan} from './person-research-standard-plan';import {commercialScopeValid,contactCapabilities} from './contact-source-policy';
import {contactStandardView} from './contact-standard-view';
import {knownProfileScope} from './known-profile-scope';
import {freeContactFollowupScope} from './free-contact-followup-scope';
import {freeEmailOwnershipScope} from './free-email-ownership-scope';
import {freeContactAlternativeScope} from './free-contact-alternative-scope';
import {freeTombaScope} from './free-tomba-scope';
import {newContactBatchScope} from './new-contact-batch-scope';
export async function readPersonScope(){
  try{let s=JSON.parse(await fs.readFile(/* turbopackIgnore: true */ process.env.PERSON_RESEARCH_SCOPE_PATH||'.runtime/person-research-scope.json','utf8'));
    if(s.mode==='commercial')return commercialScopeValid(s)?s:null;
    const profileBatch=s.batchType==='known_profile_emails';if(profileBatch){s=knownProfileScope(s);if(!s)return null;}
    const followup=s.batchType==='free_contact_followup';if(followup){s=freeContactFollowupScope(s);if(!s)return null;}
    const ownership=s.batchType==='free_email_ownership';if(ownership){s=freeEmailOwnershipScope(s);if(!s)return null;}
    const alternative=s.batchType==='free_contact_alternative';if(alternative){s=freeContactAlternativeScope(s);if(!s)return null;}
    const tomba=s.batchType==='free_tomba';if(tomba){s=freeTombaScope(s);if(!s)return null;}
    const next=s.batchType==='new_contact_free';if(next){s=newContactBatchScope(s);if(!s)return null;}
    if(!s.enabled||!s.id||!s.tenantId||!s.actorId||!s.people?.length||s.people.length>(next?20:ownership||alternative||tomba?26:followup?65:profileBatch?63:6)||s.minutes!==(tomba?100:followup?90:60)||!Number.isFinite(Date.parse(s.notAfter))||Date.parse(s.notAfter)<=Date.now())return null;
    if(!next&&!followup&&!ownership&&!alternative&&!tomba&&!Object.entries(personLimits).every(([key,max])=>Number.isFinite(s.limits?.[key])&&s.limits[key]>=0&&s.limits[key]<=max))return null;
    if(!tomba&&s.limits.searches&&(!Number.isFinite(Date.parse(s.freeQuotaVerifiedAt))||Date.now()<Date.parse(s.freeQuotaVerifiedAt)||Date.now()-Date.parse(s.freeQuotaVerifiedAt)>86400000))return null;
    if(s.send!==false||s.purchase!==false||s.phoneReveal!==false||s.waterfall!==false)return null;
    return s;
  }catch{return null;}
}
export function personExecutionAllowed(row:Campaign,batch:PersonBatch,scope:any){
  return !!scope&&scope.tenantId===row.tenant_id&&scope.enabled&&Date.now()<Date.parse(scope.notAfter)&&
    batch.people.every(p=>scope.people.some((a:any)=>a.campaignId===row.id&&a.companyId===p.companyId&&a.personId===p.personId)||batch.selectionId==='discovery'&&scope.companies?.some((c:any)=>c.campaignId===row.id&&c.companyId===p.companyId))&&
    (!batch.scopeId||batch.scopeId===scope.id)&&(!batch.expiresAt||Date.now()<Date.parse(batch.expiresAt));
}
export function personResearchView(row:Campaign,scope:any=null){
  const view=personSelectionView(row),batches:PersonBatch[]=row.data.personResearchBatches||[];
  const own=scope?.tenantId===row.tenant_id?scope:null;
  const publicBatches=JSON.parse(JSON.stringify(batches,(key,value)=>['observation','rawResponse','raw','requests','providerReceipts','fieldObservations','lease'].includes(key)?undefined:value));
  return {...view,batches:publicBatches,companies:row.data.companies.map((c:any)=>({id:c.id,name:c.name})),standard:contactStandardView(row),capabilities:contactCapabilities(own,row.tenant_id),execution:{enabled:!!own,maxPeople:own?.maxPeople||6,limits:own?.limits||null,notAfter:own?.notAfter||null},sent:0};
}
export function applyPersonResearch(row:Campaign,tenantId:string,actorId:string,raw:unknown,scope:any,now=new Date().toISOString()){
  const input=personResearchInput.parse(raw);
  if(row.id!==input.campaignId||row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);
  if(row.state==='running'||row.data.operatorLease||row.data.contactLease||row.data.contactBatchLease||row.data.apolloContactLease)throw new AccessError('CONTACT_RESEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
  if(input.action==='save_selection'){
    if((row.data.personResearchBatches||[]).some((b:PersonBatch)=>['queued','running'].includes(b.state)))throw new AccessError('PERSON_BATCH_ACTIVE',409);
    return savePersonSelection(row,tenantId,actorId,{personIds:input.personIds||[],fields:input.fields||['career','profile','work_email','public_phone'],expectedVersion:input.expectedVersion},now,scope?.tenantId===tenantId?scope.maxPeople||6:6);
  }
  const batches:PersonBatch[]=row.data.personResearchBatches||=[];
  if(input.action==='prepare'){
    const plan=standardPersonPlan(row,scope,now,input.companyIds);if(!batches.some(b=>b.id===plan.id)){if(batches.length>=50)throw new AccessError('PERSON_BATCH_HISTORY_LIMIT',409);batches.push(plan);return {changed:true};}return {changed:false};
  }
  const batch=batches.find(b=>b.id===input.batchId);if(!batch)throw new AccessError('PERSON_BATCH_NOT_FOUND',404);
  if(input.action==='pause'){const changed=batch.state!=='done'&&!batch.pauseRequested;if(changed){batch.pauseRequested=true;
    if(batch.lease&&Date.parse(batch.lease.until)<=Date.parse(now)&&!batch.steps.some(s=>s.state==='reserved'))delete batch.lease;
    if(!batch.lease)batch.state='paused';}return {changed};}
  if(input.action==='resume'&&scope?.renewalEvidence&&batch.scopeId===scope.id&&Date.parse(batch.expiresAt||scope.notAfter)<=Date.parse(now)){
    if(batch.steps.some(s=>['reserved','unknown'].includes(s.state))||batch.lease&&Date.parse(batch.lease.until)>Date.parse(now))throw new AccessError('PERSON_UNKNOWN_REQUIRES_RECONCILIATION',409);
    const renewed={...batch,expiresAt:scope.notAfter};if(!personExecutionAllowed(row,renewed,scope)||scope.actorId!==actorId)throw new AccessError('PERSON_SCOPE_REQUIRED_OR_EXPIRED',403);
    ((batch as any).renewalHistory||=[]).push({priorExpiresAt:batch.expiresAt,renewedAt:now,evidence:scope.renewalEvidence});batch.expiresAt=scope.notAfter;
  }
  if(!personExecutionAllowed(row,batch,scope)||scope.actorId!==actorId)throw new AccessError('PERSON_SCOPE_REQUIRED_OR_EXPIRED',403);
  if(batch.selectionId!=='discovery'&&row.data.personResearchSelection?.id!==batch.selectionId)throw new AccessError('PERSON_SELECTION_STALE',409);
  const pendingProvider=batch.steps.some(s=>s.kind==='finder'&&s.state==='done'&&s.result?.state==='provider_pending');
  if(batch.state==='done'&&!(input.action==='resume'&&pendingProvider)||['queued','running'].includes(batch.state))return {changed:false};
  if(batch.steps.some(s=>s.state==='unknown'||s.state==='reserved'))throw new AccessError('PERSON_UNKNOWN_REQUIRES_RECONCILIATION',409);
  if(batch.state==='blocked')throw new AccessError('PERSON_SOURCE_OR_BUDGET_BLOCKED',409);
  if(input.action==='resume'){
    const pending=batch.steps.filter(s=>s.state==='done'&&(s.kind==='verify'&&s.result?.technical?.pending||s.kind==='finder'&&s.result?.state==='provider_pending'));
    if(pending.length){if(((batch as any).verificationResumes||0)>=2)throw new AccessError('EMAIL_VERIFICATION_POLL_LIMIT',409);
      (batch as any).verificationResumes=((batch as any).verificationResumes||0)+1;
      for(const step of pending){step.state='pending';step.input.continuation=true;}}
  }
  batch.startedAt||=now;batch.expiresAt||=new Date(Math.min(Date.parse(now)+(scope.minutes||60)*60000,Date.parse(scope.notAfter))).toISOString();
  batch.scopeId=scope.id;batch.state='queued';batch.pauseRequested=false;return {changed:true};
}
