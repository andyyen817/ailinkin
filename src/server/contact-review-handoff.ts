import 'server-only';
import {createHash} from 'node:crypto';
import type {Campaign} from '@/domain/research';
import {AccessError} from './policy';
import {reviewView} from './contact-review-service';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function contactMailHandoff(row:Campaign){
  const view=reviewView(row),saved=row.data.contactMailHandoff;
  if(!saved)return null;
  const current=view.confirmation?.valid&&saved.confirmationId===view.confirmation.id&&saved.draftBasis===draftBasis(row,saved.recipients);
  return {...saved,superseded:!current||!!saved.superseded,sendReady:false};
}
function draftBasis(row:Campaign,recipients:any[]){return hash(recipients.map(r=>[r.companyId,
  row.data.companies.find((c:any)=>c.id===r.companyId)?.contactPackage?.draft||null]));}
export function prepareReviewedMail(row:Campaign,now=new Date().toISOString()){
  const view=reviewView(row),confirmation=view.confirmation;
  if(!confirmation?.valid)throw new AccessError('CONTACT_REVIEW_CONFIRMATION_REQUIRED',409);
  const recipients=confirmation.recipients.map((r:any)=>{
    const source=view.rows.find(s=>s.id===r.rowId&&s.basisHash===r.basisHash);
    if(!source)throw new AccessError('CONTACT_REVIEW_STALE',409);
    if(source.kind!=='channel'||source.channelKind!=='email')throw new AccessError('CONTACT_EMAIL_SELECTION_INVALID',400);
    const company=row.data.companies.find((c:any)=>c.id===r.companyId),draft=company?.contactPackage?.draft;
    return {...r,companyName:source.companyName,verification:source.verification,evidence:source.evidence,
      subject:draft?.subjects?.[0]||'',body:draft?.first||'',draftAvailable:!!draft,
      notice:r.scope==='company'?'用户选择的公司公共邮箱；没有将其认定为个人邮箱':'用户选择的公开人员渠道，任职和采购权按证据状态保留'};
  });
  const basis=draftBasis(row,recipients),old=contactMailHandoff(row);
  if(old&&!old.superseded&&old.draftBasis===basis)return {changed:false,handoff:old,sent:0};
  const handoff={id:'MH-'+hash([confirmation.id,basis]).slice(0,24),confirmationId:confirmation.id,draftBasis:basis,
    recipients,createdAt:now,superseded:false,sendReady:false,sent:0,
    blockers:[...(!recipients.length?['尚未选择可联系邮箱']:[]),...recipients.filter((r:any)=>!r.draftAvailable).map((r:any)=>`${r.companyName} 尚无可复用草稿`),
      ...recipients.filter((r:any)=>r.verification!=='valid').map((r:any)=>`${r.email} 邮箱可用性未验证`),
      '企业发件邮箱与发送接口尚未接入','需要确认实际邮件内容、署名和发送范围']};
  if(row.data.contactMailHandoff){const history=row.data.contactMailHandoffHistory||=[];
    if(history.length>=100)throw new AccessError('CONTACT_MAIL_HISTORY_LIMIT',409);history.push({...row.data.contactMailHandoff,superseded:true});}
  row.data.contactMailHandoff=handoff;
  return {changed:true,handoff,sent:0};
}
