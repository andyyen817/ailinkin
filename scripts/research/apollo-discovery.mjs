import {searchOrganizations} from './apollo.mjs';
import {hash,host} from './core.mjs';
import {id,httpUrl,assertProject} from './schema.mjs';
import {findCompany,exclusiveDomain} from './company-identity.mjs';
import {coverageQueryOrder,executionLimit,discoveryStop} from './discovery-policy.mjs';

function website(row) {
  try{return httpUrl(row.website_url||(row.primary_domain?'https://'+row.primary_domain:''));}catch{return '';}
}
export async function discoverApollo(data,call,checkpoint) {
  assertProject(data.project);
  const queries=coverageQueryOrder(data);
  if(data.companies.length>=executionLimit(data)||discoveryStop(data))return;
  for(const keyword of queries){
    const rounds=data.project.discoveryMode==='exclude_rounds';
    const exclusions=rounds?[...new Set([...(data.project.excludedDomains||[]),
      ...data.companies.map(exclusiveDomain).filter(Boolean)])].sort():data.project.excludedDomains||[];
    const exclusionHash=hash(JSON.stringify(exclusions));
    const baseId=hash(JSON.stringify(['apollo',data.project.country,data.project.city,keyword]));
    const batchId=rounds?hash(JSON.stringify([baseId,exclusionHash])):baseId;
    let batch=data.batches.find(b=>b.id===batchId);
    if(batch?.status==='已完成')continue;
    if(['待核实','访问受限／未接入'].includes(batch?.status))return;
    batch ||= {id:batchId,baseId,exclusionHash,generation:rounds?data.batches.filter(b=>b.baseId===baseId).length+1:1,
      query:keyword,keyword,source:'Apollo 企业搜索',provider:'apollo',nextPage:1,count:0,added:0,duplicates:0,excluded:[],excludedDomains:exclusions};
    if(!data.batches.includes(batch))data.batches.push(batch);
    batch.status='检索中';await checkpoint();
    try{
      const page=rounds?1:batch.nextPage||1,result=await searchOrganizations(call,{...data.project,excludedDomains:batch.excludedDomains||[]},keyword,page);
      for(const raw of result.results){
        batch.count++;
        if(!raw?.name?.trim()){batch.excluded.push({page,reason:'缺少企业名称，原始记录保留在供应商响应',providerId:raw?.id||null});continue;}
        const url=website(raw),providerId=String(raw.id||'');
        let company=findCompany(data.companies,{apolloId:providerId,website:url});
        const evidence={provider:'apollo',providerId,query:keyword,page,title:raw.name,url:url||'https://app.apollo.io',retrievedAt:new Date().toISOString(),summary:String(raw.short_description||raw.seo_description||raw.industry||'供应商未提供业务摘要')};
        if(company){batch.duplicates++;if(!company.apolloId)company.apolloId=providerId;}
        else {
          company={id:id('C'),apolloId:providerId,name:raw.name.trim(),country:raw.country||'未知',city:raw.city||'',website:url,source:url||'https://app.apollo.io',status:'待核实',fitStatus:'待评估',fitReason:'企业与采购需求尚未核实',industry:raw.industry||'',employees:raw.estimated_num_employees??null,discovery:[],updatedAt:new Date().toISOString()};
          data.companies.push(company);batch.added++;
        }
        company.discovery ||= [];
        if(!company.discovery.some(e=>e.provider==='apollo'&&e.query===keyword&&e.page===page))company.discovery.push(evidence);
      }
      batch.page=page;batch.moreAvailable=Boolean(result.nextPage);
      batch.nextPage=rounds?null:result.nextPage;batch.status=rounds?'已完成':result.nextPage?'待续—仍有分页':'已完成';
      batch.finishedAt=new Date().toISOString();delete batch.error;call.commit?.();await checkpoint();
      coverageQueryOrder(data);
    }catch(error){batch.status=error.status||'待重试';batch.error=error.message;await checkpoint();throw error;}
    return; // One page per user action, including when the supplier has more results.
  }
}
