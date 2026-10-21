import {companyRoute} from './apollo.mjs';
import {httpUrl} from './schema.mjs';
import {ProviderError} from './http.mjs';
import {matchesEntityText} from './locator-plan.mjs';
export const apolloLocatorBody=name=>({q_organization_name:name,page:1,per_page:10});
export async function locateOrganizations(call,entity){
  if(typeof entity.name!=='string'||!entity.name.trim()||entity.name.length>200)throw Error('ORGANIZATION_NAME_REQUIRED');
  const raw=await call('apollo',companyRoute,apolloLocatorBody(entity.name));
  if(!Array.isArray(raw.organizations)||raw.organizations.length>10)throw new ProviderError('Apollo 组织定位响应结构不完整，原始响应保留','待核实');
  return raw.organizations.flatMap(r=>{
    if(typeof r.name!=='string'||!matchesEntityText(entity,r.name))return [];
    try{
      const url=httpUrl(r.website_url||(r.primary_domain?'https://'+r.primary_domain:''));
      return [{title:r.name,url,snippet:String(r.short_description||r.seo_description||r.industry||''),
        sourceId:r.id?'apollo:'+r.id:null,provider:'apollo',apolloId:r.id||null,
        declaredName:r.name,headquarters:{country:r.country||null,city:r.city||null},ownershipVerified:false}];
    }catch{return [];}
  });
}
