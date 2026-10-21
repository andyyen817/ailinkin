import {ProviderError} from './http.mjs';
import {compileSearchSpec} from './search-spec.mjs';

export const companyRoute='/api/v1/mixed_companies/search';
export function apolloLocation(country,city='') {
  const aliases={'瑞典':'Sweden','中国':'China','中国大陆':'China','大陆':'China','美国':'United States','德国':'Germany','英国':'United Kingdom','印尼':'Indonesia','印度尼西亚':'Indonesia','菲律宾':'Philippines'};
  const name=aliases[country.trim()]||country.trim();
  if(!name||/\p{Script=Han}/u.test(name+' '+city))throw new ProviderError('Apollo 地区请使用英文；可使用已支持国家的中文名称，如印尼、菲律宾。','待核实');
  return city.trim()?city.trim()+', '+name:name;
}
export async function searchOrganizations(call,project,keyword,page=1) {
  if(!Number.isInteger(page)||page<1||page>500)throw new Error('Apollo 页码超出范围');
  const spec=compileSearchSpec({...project,discoveryProvider:'apollo'},keyword);
  const body={organization_locations:[apolloLocation(spec?.market||project.country,project.city)],
    q_organization_keyword_tags:spec?.organizationKeywords||[keyword],page,per_page:100};
  if(project.excludedDomains?.length)body.not_organization_websites_list=[...new Set(project.excludedDomains)];
  const raw=await call('apollo',companyRoute,body);
  if(!Array.isArray(raw.organizations)||raw.organizations.length>100)throw new ProviderError('Apollo 企业响应缺少有效 organizations 数组，已保留原始响应。','待核实');
  if(raw.organizations.some(r=>{try{const h=new URL(r.website_url||'https://'+r.primary_domain).hostname.replace(/^www\./,'');return (project.excludedDomains||[]).some(d=>h===d||h.endsWith('.'+d));}catch{return false;}}))throw new ProviderError('EXCLUSION_VIOLATION：Apollo 返回了已排除的官网。','待核实');
  const pages=Number(raw.pagination?.total_pages);
  const more=Number.isFinite(pages)?page<pages:raw.organizations.length===100;
  return {results:raw.organizations,nextPage:more&&page<500?page+1:null,filters:body};
}
