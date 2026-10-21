import 'server-only';
import type {Campaign} from '@/domain/research';
import {contactReviewTable} from './contact-review-table';
import {contactPlatforms,platformCatalog} from '../../scripts/research/platform-catalog.mjs';
export function preciseContactQueries(row:Campaign,confirmedCompanies?:any[]){
  const table=contactReviewTable(row),plan=row.data.contactResearchPlans?.at(-1),queries:any[]=[];
  const quote=(v:string)=>'"'+v.replace(/["\r\n]/g,' ').trim()+'"';
  for(const c of confirmedCompanies||plan?.companies||[]){
    const people=table.rows.filter(r=>r.companyId===c.companyId&&r.kind==='person');
    for(const p of people){
      const full=p.name.trim().split(/\s+/).length>=2,associated=p.admissionState!=='held'&&p.evidence.some(e=>e.quote.toLowerCase().includes(c.name.toLowerCase()));
      queries.push({companyId:c.companyId,companyName:c.name,rowId:p.id,personName:p.name,platform:'LinkedIn',query:`${quote(p.name)} ${quote(c.name)} site:linkedin.com/in`,
        priority:full&&associated?1:3,status:'planned',purpose:full?'核对身份、现任与历史任职及公开联系路径':'姓名不完整，先核对完整身份',
        notice:'现任、前任、合作方和待核实提及均保留；不要求采购职位',evidence:p.evidence,externalRequests:0});
      if(full&&associated)queries.push({companyId:c.companyId,companyName:c.name,rowId:p.id,personName:p.name,platform:'网页',
        query:`${quote(p.name)} ${quote(c.name)}`,priority:1,status:'planned',purpose:'核对人物身份、职业经历及公开商务渠道',evidence:p.evidence,externalRequests:0});
    }
    for(const platform of contactPlatforms.filter(p=>p!=='网页')){
      const accounts=(c.accounts||[]).filter((a:any)=>a.platform===platform),domain=platformCatalog[platform].domains[0];
      queries.push({companyId:c.companyId,companyName:c.name,platform,query:`${quote(c.name)} site:${domain}`,priority:accounts.length?2:3,
        status:accounts.length?'saved_account_first':'planned',purpose:'搜集公司账号及公开人员、职位和联络资料',
        accountUrls:accounts.map((a:any)=>a.url),evidence:accounts.flatMap((a:any)=>a.evidence),externalRequests:0});
    }
  }
  return {queries:queries.sort((a,b)=>a.priority-b.priority),externalRequests:0,
    notice:'精确查询尚未发送；先复用已保存账号和证据。真实查询与页面读取使用已确认批次，受限来源记录后切换到获准来源。'};
}
