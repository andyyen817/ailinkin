import 'server-only';
import type {Campaign} from '@/domain/research';import type {ReviewRow} from '@/domain/contact-review';
import {contactReviewTable} from './contact-review-table';
export function contactStandardView(row:Campaign,rows:ReviewRow[]=contactReviewTable(row).rows,now=Date.now()){
  const people=rows.filter(r=>r.kind==='person').map(p=>({personId:p.personId,rowId:p.id,companyId:p.companyId,companyName:p.companyName,name:p.name,title:p.title,
    identity:p.admissionState||'unknown',relationship:p.relationship,careers:p.careerHistory||[],channelCount:p.personChannels?.length||0,
    missing:[!p.profileUrl?'个人主页':'',!p.personChannels?.some(c=>c.kind==='email')?'个人邮箱':'',!p.personChannels?.some(c=>['phone','whatsapp'].includes(c.kind))?'公开电话':''].filter(Boolean),evidence:p.evidence}));
  const channels=rows.filter(r=>r.kind==='channel').map(r=>({rowId:r.id,companyName:r.companyName,companyId:r.companyId,personId:r.ownerPersonId||'',
    name:people.find(p=>p.personId===r.ownerPersonId)?.name||'',kind:r.channelKind,value:r.value,scope:r.scope,ownership:r.checks?.ownership||'unknown',
    employer:r.checks?.channelEmployer||'',targetEmployer:r.checks?.targetEmployer||'unknown',provenance:r.checks?.provenance||'unknown',
    technical:r.checks?.technical||null,technicalState:r.checks?.technical?.pending?'pending':r.checks?.technical?.expiresAt&&Date.parse(r.checks.technical.expiresAt)<=now?'expired':r.checks?.technical?.status||r.verification,
    evidence:r.evidence}));
  const coverage=(row.data.personResearchBatches||[]).flatMap((b:any)=>b.steps.map((s:any)=>({batchId:b.id,personId:s.personId,companyId:b.people.find((p:any)=>p.personId===s.personId)?.companyId,
    source:s.input.provider||s.kind,sourceId:s.input.sourceId||'',state:s.state==='done'&&['restricted','blocked','qualification_unverified','domain_unverified','not_found','provider_pending','identity_ambiguous'].includes(s.result?.state)?s.result.state:s.state,reason:s.error||s.result?.notice||s.result?.reason||'',url:s.input.url||'',reused:!!s.reused||!!s.result?.reused})));
  return {people,channels,coverage,metrics:{people:people.length,personalChannels:channels.filter(c=>c.scope==='person').length,
    namedEmails:channels.filter(c=>c.scope==='person'&&c.kind==='email').length,technicallyValid:channels.filter(c=>c.technicalState==='valid'&&c.technical?.verifiedAt&&Date.parse(c.technical.expiresAt||'')>now).length,
    unknownOperations:coverage.filter((c:any)=>c.state==='unknown').length,reused:coverage.filter((c:any)=>c.reused).length}};
}
