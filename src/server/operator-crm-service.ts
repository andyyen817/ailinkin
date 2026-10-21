import 'server-only';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {campaign} from './research-store';
import {persistContactReview} from './contact-review-service';
import {importContact} from './contacts';
import {AccessError} from './policy';
import {operatorCrmReview,operatorCrmMatch,reviewHash} from './operator-crm-policy';

export const operatorCrmInput=z.object({
  campaignId:z.uuid(),batchId:z.uuid(),basisHash:z.string().regex(/^[a-f0-9]{64}$/),
  personKeys:z.array(z.string().min(1).max(200)).min(1).max(100),confirm:z.literal(true)
}).strict();
async function existingContacts(tx:any,tenantId:string,people:any[]){
  const profiles=people.map(p=>p.data?.linkedin).filter(Boolean);
  const emails=people.map(p=>p.data?.email).filter(Boolean);
  return tx.$queryRaw`SELECT id,data,version FROM contact WHERE tenant_id=${tenantId}
    AND (linkedin=ANY(${profiles}::text[]) OR email=ANY(${emails}::text[]))`;
}
export async function viewOperatorCrm(tx:any,tenantId:string,campaignId:string,batchId:string){
  const row=await campaign(tx,campaignId),review=operatorCrmReview(row,tenantId,batchId);
  const contacts=await existingContacts(tx,tenantId,review.people);
  return {...review,people:review.people.map((person:any)=>{
    const match=operatorCrmMatch(person,contacts),contact=match.contact;
    return {...person,reason:person.reason||match.reason,canSave:person.canSave&&!match.reason,
      contactId:contact?.id||null,stage:contact?.data.stage||'待筛选',
      doNotContact:!!contact?.data.doNotContact};
  }),history:((row.data as any).operatorCrmReviews||[]).filter((r:any)=>r.batchId===batchId)};
}
export async function saveOperatorCrm(tx:any,tenantId:string,actorId:string,raw:unknown){
  const input=operatorCrmInput.parse(raw);
  if(new Set(input.personKeys).size!==input.personKeys.length)throw new AccessError('CRM_DUPLICATE_SELECTION',400);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId},0))`;
  const row=await campaign(tx,input.campaignId),review=operatorCrmReview(row,tenantId,input.batchId);
  if(review.basisHash!==input.basisHash)throw new AccessError('CRM_REVIEW_STALE',409);
  const selected=input.personKeys.map(key=>review.people.find((p:any)=>p.personKey===key));
  if(selected.some(p=>!p||!p.canSave))throw new AccessError('CRM_PERSON_NOT_READY',409);
  const key=reviewHash([input.batchId,input.basisHash,[...input.personKeys].sort()]);
  const data=row.data as any,history=data.operatorCrmReviews||[];
  const previous=history.find((r:any)=>r.key===key);
  if(previous)return {receipt:previous,reused:true};
  if(history.length>=100)throw new AccessError('CRM_REVIEW_HISTORY_LIMIT',409);
  const existing=await existingContacts(tx,tenantId,selected);
  const results:any[]=[];
  for(const person of selected){
    const match=operatorCrmMatch(person,existing);
    if(match.reason){results.push({personKey:person.personKey,name:person.name,outcome:'conflict',reason:match.reason});continue;}
    const saved=await importContact(tx,tenantId,person.data,'fill_empty');
    const i=existing.findIndex((c:any)=>c.id===saved.record.id);
    if(i<0)existing.push(saved.record);else existing[i]=saved.record;
    results.push({personKey:person.personKey,name:person.name,contactId:saved.record.id,
      outcome:saved.outcome,doNotContact:!!saved.record.data.doNotContact});
  }
  const receipt={id:randomUUID(),key,batchId:input.batchId,basisHash:input.basisHash,
    actorId,at:new Date().toISOString(),selectedPersonKeys:[...input.personKeys],results};
  data.operatorCrmReviews=[...history,receipt];
  await persistContactReview(tx,row,tenantId);
  return {receipt,reused:false};
}
