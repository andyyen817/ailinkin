import 'server-only';
import type {Campaign} from '@/domain/research';
import type {ReviewRow,ReviewEvidence} from '@/domain/contact-review';
import {reviewView} from './contact-review-service';
import {contactStandardView} from './contact-standard-view';
import {personalContactSummary} from './personal-contact-summary';
import {contactAddressOverview,operatorContactSummary} from './contact-excel-bundle';
import {contactBatchOutcome} from './contact-batch-outcome';
import {operatorContactStatus} from './operator-contact-status';
import {enrichContactExcel} from './contact-enrichment-export';
export type ContactExcelSheet={name:string;headers:string[];widths:number[];rows:string[][];decisionColumn?:number;linkColumn?:number};
const relations:Record<string,string>={unknown:'关系待核实',current_employee:'原文提及职位，现任待核实',former_employee:'历史任职提及，日期待核实',founder:'创立关系提及，现任待核实',partner:'合作关系提及，待核实',mentioned:'人物提及，关联待核实'};
const scopes:Record<string,string>={company:'公司公共渠道',store:'门店渠道',person:'个人渠道候选，归属待核实',unknown:'渠道归属待确认'};
const states:Record<string,string>={unknown:'尚未核实',unverified:'未验证',ownership_needs_review:'已公开，归属及有效性待核实',provider_work_email_candidate:'供应商工作邮箱候选，尚未验证',provider_company_phone:'供应商记录的公司电话',valid:'有验证依据',invalid:'无效',catch_all:'接收全部地址，具体邮箱待核实'};
const decisions:Record<string,string>={unreviewed:'未判断',keep:'保留',exclude:'排除',needs_info:'待补充'};
const kinds:Record<string,string>={email:'邮箱',phone:'电话',whatsapp:'WhatsApp',social:'社媒链接',contact_page:'官网联系页面'};
const sourceTypes:Record<string,string>={search_snippet:'搜索摘要线索',website_body:'网页正文',social_body:'社媒正文',provider_receipt:'供应商结构化回执'};
const status=(labels:Record<string,string>,v:string)=>labels[v]||'状态待确认';
function chunks(text:string){const result:string[]=[];for(let i=0;i<text.length;){let end=Math.min(i+600,text.length);if(/[\uD800-\uDBFF]/.test(text[end-1]||''))end--;result.push(text.slice(i,end));i=end;}return result.length?result:[''];}
function jobs(row:ReviewRow){const list=row.careerHistory||[],j=list[0];return j?`${j.status==='former_claim'?'历史任职':'任职声明，待核实'}：${j.employer} ${j.title} ${j.period||'日期未知'}${list.length>1?'\n共'+list.length+'条经历，完整原文见“完整来源”':''}`:'任职经历尚未取得';}
function uniqueEvidence(row:ReviewRow):ReviewEvidence[]{return [...new Map([...row.evidence,...(row.careerHistory||[]).flatMap(j=>j.evidence),...(row.personChannels||[]).flatMap(c=>c.evidence)].map(e=>[JSON.stringify(e),e])).values()];}
export function contactExcelView(campaign:Campaign,companyId?:string){
  const view=reviewView(campaign);if(companyId&&!view.rows.some(r=>r.companyId===companyId))throw Error('CONTACT_EXCEL_COMPANY_NOT_FOUND');
  const selected=view.rows.filter(r=>!companyId||r.companyId===companyId);if(selected.length>2000)throw Error('CONTACT_EXCEL_TOO_LARGE');
  const judgments=new Map(view.judgments.map(j=>[j.rowId,j]));
  const outcomes=new Map(contactBatchOutcome(selected).people.map(p=>[p.rowId,p]));
  const sales:ContactExcelSheet={name:'个人联系方式',headers:['企业','姓名','联系结果','个人工作邮箱','邮箱是否有效','个人电话／WhatsApp','个人主页网址','下一步及未找到原因','销售判断','销售备注位置','任职及历史经历','资料来源'],widths:[16,23,22,32,29,18,36,32,13,24,48,44],rows:[],decisionColumn:9,linkColumn:12};
  const channels:ContactExcelSheet={name:'公司公共渠道',headers:['企业','渠道类别','公开联系值','渠道归属','可用状态','来源网址','联系提醒','销售判断','销售备注'],widths:[22,20,45,30,35,45,40,13,30],rows:[],decisionColumn:8,linkColumn:6};
  const sources:ContactExcelSheet={name:'完整来源',headers:['企业','姓名或渠道','资料类别','关系或渠道归属','来源平台','来源类型','来源网址','发布日期原文','获取时间原文','完整原文分段','原文段次','任职状态','职位原文','原文缺项说明','资料编号'],widths:[20,26,14,30,16,23,48,24,28,82,12,24,32,50,40],rows:[],linkColumn:7};
  for(const row of selected){const j=judgments.get(row.id)!;const decision=status(decisions,j.decision),source=row.evidence[0]?.sourceUrl||'';
    if(row.kind==='person'){
      const contact=personalContactSummary(row),outcome=outcomes.get(row.id)!,attempt=!contact.hasEmail&&!contact.hasPhone&&!row.doNotContact?operatorContactStatus(campaign,row):null;
      sales.rows.push([row.companyName,row.name,attempt?.status||outcome.status,attempt?.status==='未查询'?'未查询':contact.email,attempt?.status==='未查询'?'尚未验证':contact.emailState,contact.phone,contact.profiles,
        [attempt?.reason||outcome.nextAction,attempt?'':outcome.reason,outcome.duplicateNotice,j.stale?'资料有变化，需重新判断':''].filter(Boolean).join('\n'),decision,j.note?'完整备注见“完整来源”':'未填写',
        (row.title||'职位未取得')+'\n'+status(relations,row.relationship)+'\n'+jobs(row),source]);
      if(j.note){const notes=chunks(j.note);for(let i=0;i<notes.length;i++)sources.rows.push([row.companyName,row.name,'销售备注',decision,'SaaS销售记录','用户保存','', '未知',campaign.data.contactReview?.decisions?.[row.id]?.updatedAt||'未知',notes[i],`${i+1}/${notes.length}`,'','', '完整备注保留；销售判断以SaaS保存内容为准',row.id]);}
    }else{
      if(row.scope!=='person')channels.rows.push([row.companyName,status(kinds,row.channelKind),row.value,status(scopes,row.scope),status(states,row.verification),source,
        row.scope==='person'?'这是个人渠道候选，归属尚未确认':row.scope==='unknown'?'归属未确认；不能当作任何人的个人联系方式':'公司或门店公开渠道；不代表个人邮箱或电话',decision,j.note]);
    }
    for(const evidence of uniqueEvidence(row)){const parts=chunks(evidence.quote||'');for(let i=0;i<parts.length;i++)sources.rows.push([row.companyName,row.name||row.value,row.kind==='person'?'人物':'公开渠道',status(row.kind==='person'?relations:scopes,row.kind==='person'?row.relationship:row.scope),
      row.platforms.join('、'),evidence.sourceType?status(sourceTypes,evidence.sourceType):'来源类型未记录',evidence.sourceUrl,evidence.publishedAt||'未知',evidence.retrievedAt||'未知',parts[i],`${i+1}/${parts.length}`,
      row.employerVerified?'有任职依据；时效仍需确认':'身份、关联及任职时间待核实',row.title||'未取得',[...(row.detailUnknowns||[]),...(row.careerUnknowns||[])].join('\n'),row.id]);}
  }
  const standard=contactStandardView(campaign,selected);
  sales.rows.sort((a,b)=>a[0].localeCompare(b[0])||Number(b[4].includes('技术验证通过'))-Number(a[4].includes('技术验证通过'))||Number(a[3]==='未找到')-Number(b[3]==='未找到')||a[1].localeCompare(b[1]));
  const routes:ContactExcelSheet={name:'联系渠道与验真',headers:['企业','姓名','渠道类别','联系值','归属','归属依据','渠道雇主','目标企业关系','来源类型','技术状态','本次请求时间','实际验证日期','验证有效期','来源网址'],widths:[20,24,15,40,18,24,24,24,24,20,25,25,25,48],rows:standard.channels.map(c=>[c.companyName,c.name||'未绑定个人',status(kinds,c.kind),c.value,status(scopes,c.scope),c.ownership,c.employer||'未知',c.targetEmployer,c.provenance,c.technicalState,c.technical?.requestedAt||'未验证',c.technical?.verifiedAt||'供应商未提供',c.technical?.expiresAt||'未知',c.evidence.map(e=>e.sourceUrl).join('\n')]),linkColumn:14};
  const coverage:ContactExcelSheet={name:'研究覆盖与缺项',headers:['企业','姓名','步骤或平台','执行状态','限制或缺项','来源网址','是否复用'],widths:[22,26,22,18,65,48,16],rows:standard.coverage.map((c:any)=>[campaign.data.companies.find((v:any)=>v.id===c.companyId)?.name||'未知',standard.people.find(p=>p.personId===c.personId)?.name||'企业人物发现',c.source,c.state,c.reason,c.url,c.reused?'复用':'本次步骤']),linkColumn:6};
  for(const p of standard.people)coverage.rows.push([p.companyName,p.name,'人物缺项','待补充',p.missing.join('、')||'本投影字段已有资料','','']);
  const enrichment=(campaign.data as any).operatorBatches?.findLast((b:any)=>b.mode==='people_enrichment');
  for(const p of enrichment?.people||[])if(!companyId||p.companyId===companyId)for(const c of p.publicChecks||[])coverage.rows.push([p.companyName,p.name,'公开网页归属核查',c.state==='read'?'已读取':'未读取',c.reason,c.url,'见批次回执']);
  enrichContactExcel(campaign,sales);
  const contacts=selected.filter(r=>r.kind==='person').map(r=>personalContactSummary(r));
  const address=contactAddressOverview(sales.rows);
  const contactSummary=operatorContactSummary(sales.rows);
  const contactCounts={emails:contacts.filter(c=>c.hasEmail).length,validEmails:contacts.filter(c=>c.hasValidEmail).length,phones:contacts.filter(c=>c.hasPhone).length,profiles:contacts.filter(c=>c.hasProfile).length};
  return {sheets:[sales,channels,sources,routes,coverage],contactSummary,contactCounts,companyCount:new Set(selected.map(r=>r.companyId)).size,personRows:sales.rows.length,channelRows:channels.rows.length,sourceRows:sources.rows.length,
    market:String(campaign.data.project?.country||'目标市场'),notice:'点击来源网址查看依据。选择保留、排除或待补充并记录备注。Excel中的判断是副本；正式联系名单请在SaaS保存确认。'};
}
