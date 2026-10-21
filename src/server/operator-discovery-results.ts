import 'server-only';
import {canonicalCountry} from './operator-discovery-provider';
import {companyDomain} from './contact-provider-finders';
import {upsertCompany} from '../../scripts/research/core.mjs';
export function applyOperatorDiscovery(batch:any,rows:any[],op:any){
  const row=rows.find(r=>r.data.operatorBatches?.some((b:any)=>b.id===batch.id));
  if(!row)throw Error('OPERATOR_DIRECTION_REQUIRED');
  if(op.state!=='done'){
    batch.reason='企业搜索来源未完成，已保留回执；未自动重试。';batch.state='blocked';return;
  }
  if(op.kind==='location'){batch.location=canonicalCountry(op.result,batch.direction.country);return;}
  const raw=op.result;
  if(!(raw.error===true&&raw.error_code==='NO_RESULTS')&&(!Array.isArray(raw.results)||raw.pagination?.current_page!==1))throw Error('OPERATOR_COMPANY_RESPONSE_INVALID');
  batch.companyChoices=[];op.held=[];
  for(const item of (raw.results||[]).slice(0,25)){
    const c=item.company||{},domain=companyDomain(c.domain||c.website||'');
    if(!domain||!c.name){op.held.push({reason:'company_name_or_domain_missing'});continue;}
    const url='https://'+domain,previous=rows.flatMap(r=>r.data.companies||[]).find(p=>companyDomain(p.website||'')===domain);
    const {company}=upsertCompany(row.data,{name:c.name,country:c.location?.country||c.hq_country||'未知',website:url,source:'https://prospeo.io',buyerType:batch.direction.customerType});
    if(previous&&previous.id!==company.id&&!row.data.companies.some((p:any)=>p.id===previous.id))company.id=previous.id;
    const evidence={provider:'prospeo',url:'https://prospeo.io',query:JSON.stringify(op.stages?.find((s:any)=>s.requestBody)?.requestBody||{}),
      title:c.name,summary:String(c.description||c.seo_description||'供应商企业搜索候选；实际采购意向待核实。'),retrievedAt:op.finishedAt};
    (company.discovery||=[]).push(evidence);company.status='供应商候选，买方关系待核实';
    batch.companyChoices.push({id:company.id,name:company.name,domain,website:url,country:company.country,summary:evidence.summary,source:'https://prospeo.io'});
  }
  op.savedCompanies=batch.companyChoices.length;
}
export function optionalRolePriority(title:string,roles:string[]=[]){
  return roles.some(role=>title.toLowerCase().includes(role.toLowerCase()))?1:0;
}
