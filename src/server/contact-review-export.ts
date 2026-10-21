import 'server-only';
import {stringify} from 'csv-stringify/sync';
import type {Campaign} from '@/domain/research';
import {reviewView} from './contact-review-service';
import {personResearchStatus} from './person-research-results';
import {contactStandardView} from './contact-standard-view';
export function contactReviewCsv(row:Campaign){
  const view=reviewView(row),safe=(v:unknown)=>{const s=String(v??'');return /^[\s]*[=+@-]/.test(s)?"'"+s:s;};
  const header=['研究企业','资料编号','资料类型','姓名','原文职位','企业关系','渠道归属','邮箱','电话','其他联系值','个人链接','任职核实','采购权','邮箱验证','CRM编号','来源平台','出处及原文','资料获取日期','用户判断','拟联系邮箱','用户备注','资料变化','采集覆盖'];
  const values=view.rows.map(r=>{const j=view.judgments.find(j=>j.rowId===r.id)!;
    return [r.companyName,r.id,r.kind,r.name,r.title,r.relationship,r.scope,r.email,r.phone,r.value,r.profileUrl,r.employerVerified?'已核实':'待核实',r.purchaseAuthority,r.verification,
      r.crmContactId,r.platforms.join('；'),r.evidence.map(e=>e.sourceUrl+' '+e.quote).join('；'),r.evidence.map(e=>e.retrievedAt||'未知').join('；'),j.decision,j.emailSelected?'用户选中':'未选中',j.note,j.stale?'需重新判断':'当前资料',
      view.coverage.filter(c=>c.companyId===r.companyId).map(c=>c.platform+':'+c.state).join('；')].map(safe);});
  header.push('任职企业原文','任职日期原文','人物缺项','企业归属提示');
  values.forEach((value,i)=>value.push(...[view.rows[i].employerClaim||'',(view.rows[i].employmentDates||[]).join('；'),(view.rows[i].detailUnknowns||[]).join('；'),view.rows[i].affiliationStatus||'unknown'].map(safe)));
  header.push('现任职位原文声明','历史职位与经历','任职时间未知的经历','人物公开联系路径','来源发布日期','职业经历待核实项');
  values.forEach((value,i)=>{const r=view.rows[i],jobs=r.careerHistory||[];
    const describe=(j:typeof jobs[number])=>[j.employer,j.title,j.period||'任职日期未知',j.verification,j.evidence.map(e=>e.sourceUrl+' '+e.quote).join(' | ')].join(' / ');
    value.push(...[jobs.filter(j=>j.status==='current_claim').map(describe).join('；'),jobs.filter(j=>j.status==='former_claim').map(describe).join('；'),jobs.filter(j=>j.status==='timing_unknown').map(describe).join('；'),
      (r.personChannels||[]).map(c=>c.kind+':'+c.value+'（归属待核实）').join('；'),r.evidence.map(e=>e.publishedAt||'未知').join('；'),(r.careerUnknowns||[]).join('；')].map(safe));});
  header.push('稳定人物编号','联络渠道归属人物编号','人物补查状态');
  values.forEach((value,i)=>value.push(...[view.rows[i].personId||'',view.rows[i].ownerPersonId||'',personResearchStatus(row,view.rows[i].personId)].map(safe)));
  const standard=contactStandardView(row);header.push('渠道归属依据','渠道所属雇主','渠道与目标企业关系','技术状态','实际验证日期','验证有效期');
  values.forEach((value,i)=>{const c=standard.channels.find(c=>c.rowId===view.rows[i].id);value.push(...[c?.ownership||'',c?.employer||'',c?.targetEmployer||'',c?.technicalState||'',c?.technical?.verifiedAt||'',c?.technical?.expiresAt||''].map(safe));});
  return '\uFEFF'+stringify([header,...values]);
}
