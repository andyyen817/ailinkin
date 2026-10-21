import 'server-only';
import {createHash} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import type {Campaign} from '@/domain/research';
import {reviewInput,emailSelectable,type Judgment,type ReviewTable} from '@/domain/contact-review';
import {AccessError} from './policy';
import {contactReviewTable} from './contact-review-table';
import {completeSavedContactBatch,savedContactBatchView} from './contact-batch-completion';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function reviewView(row:Campaign,table=contactReviewTable(row)){
  // Research adds evidence; only an explicit sales action can select a recipient.
  const saved=row.data.contactReview||{decisions:{}},judgments=table.rows.map(r=>{
    const d=saved.decisions[r.id],stale=!!d&&d.basisHash!==r.basisHash&&d.basisHash!==r.legacyBasisHash;
    return {rowId:r.id,basisHash:r.basisHash,decision:stale?'unreviewed':d?.decision||'unreviewed',emailSelected:!stale&&!!d?.emailSelected,note:d?.note||'',stale};
  });
  const confirmation=saved.confirmation;
  const valid=!!confirmation&&confirmation.reviewHash===hash(judgments)&&confirmation.tableHash===table.tableHash;
  return {...table,judgments,batchSummary:savedContactBatchView(row,table),confirmation:confirmation?{...confirmation,valid}:null};
}
export function applyReview(row:Campaign,tenantId:string,actorId:string,raw:unknown,now=new Date().toISOString()){
  const input=reviewInput.parse(raw);
  if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId||input.campaignId!==row.id)throw new AccessError('SEARCH_NOT_FOUND',404);
  if(row.state==='running')throw new AccessError('CONTACT_RESEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
  const table=contactReviewTable(row),view=reviewView(row,table);
  if(input.expectedTableHash!==table.tableHash)throw new AccessError('CONTACT_REVIEW_STALE',409);
  if(input.action==='finish_batch')return {...completeSavedContactBatch(row,actorId,table,input.companyIds,now),view:reviewView(row,table),externalRequests:0,sent:0};
  const previous=row.data.contactReview||{schemaVersion:1,decisions:{},history:[]},next=structuredClone(previous);
  if(input.action==='save_judgments'){
    if(new Set(input.entries.map(e=>e.rowId)).size!==input.entries.length)throw new AccessError('DUPLICATE_REVIEW_ROW',400);
    for(const e of input.entries){
      const r=table.rows.find(r=>r.id===e.rowId);if(!r||r.basisHash!==e.basisHash)throw new AccessError('CONTACT_REVIEW_STALE',409);
      if(e.emailSelected&&(e.decision!=='keep'||!emailSelectable(r)))throw new AccessError('CONTACT_EMAIL_SELECTION_INVALID',400);
      const old=next.decisions[e.rowId];const equal=old&&Object.keys(e).every(k=>old[k]===e[k as keyof Judgment]);
      const defaultOnly=!old&&e.decision==='unreviewed'&&!e.emailSelected&&!e.note;
      if(!equal&&!defaultOnly)next.decisions[e.rowId]={...e,actorId,updatedAt:now};
    }
    if(JSON.stringify(next.decisions)!==JSON.stringify(previous.decisions)&&next.confirmation){
      (next.history||=[]).push({...next.confirmation,supersededAt:now});delete next.confirmation;
    }
  }else{
    if(!view.judgments.some(j=>j.decision!=='unreviewed'))throw new AccessError('CONTACT_JUDGMENT_REQUIRED',409);
    if(view.judgments.some(j=>j.stale))throw new AccessError('CONTACT_REVIEW_STALE',409);
    const recipients=view.judgments.filter(j=>j.emailSelected).map(j=>{
      const r=table.rows.find(r=>r.id===j.rowId)!;
      if(j.decision!=='keep'||!emailSelectable(r))throw new AccessError('CONTACT_EMAIL_SELECTION_INVALID',400);
      return {rowId:r.id,basisHash:r.basisHash,email:r.email,companyId:r.companyId,scope:r.scope};
    });
    if(!view.confirmation?.valid){
      if(next.confirmation)(next.history||=[]).push({...next.confirmation,supersededAt:now});
      next.confirmation={id:'RC-'+hash([table.tableHash,hash(view.judgments),now]).slice(0,24),tableHash:table.tableHash,
        reviewHash:hash(view.judgments),recipients,actorId,confirmedAt:now};
    }
  }
  if((next.history||[]).length>100)throw new AccessError('CONTACT_REVIEW_HISTORY_LIMIT',409);
  const changed=JSON.stringify(previous)!==JSON.stringify(next);
  if(changed){row.data.contactReview=next;if(row.data.contactMailHandoff)row.data.contactMailHandoff.superseded=true;}
  return {changed,view:reviewView(row,table),externalRequests:0,sent:0};
}
export async function persistContactReview(tx:Prisma.TransactionClient,row:Campaign,tenantId:string){
  const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,version=version+1,updated_at=now()
    WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version} AND state<>'running'`;
  if(n!==1)throw new AccessError('SEARCH_VERSION_CONFLICT',409);
}
