import {contactText} from './contact-text-extractor.mjs';
import {companyContactRoutes} from './company-contact-routes.mjs';
const canonical=v=>{const u=new URL(v);u.hash='';return u.href.replace(/\/$/,'');};
export function savedExactContactPage(data,company,address,now=Date.now()){
  const entity=data.sourcePipeline?.entities?.find(e=>e.companyId===company.id&&e.ownership?.verified);if(!entity)return null;
  const target=canonical(address),host=new URL(company.website).hostname.replace(/^www\./,'');
  const page=entity.websitePages?.find(p=>{try{return canonical(p.url)===target&&new URL(p.url).hostname.replace(/^www\./,'')===host&&
    typeof p.content==='string'&&p.content.length>20&&Number.isFinite(Date.parse(p.retrievedAt))&&Date.parse(p.retrievedAt)<=now&&now-Date.parse(p.retrievedAt)<=30*86400000;}catch{return false;}});
  if(!page)return null;
  const links=page.linkDetails||page.links||[],text=contactText({url:page.url,text:page.content,links,companyId:company.id,retrievedAt:page.retrievedAt});
  const routes=companyContactRoutes({...entity,websitePages:[page]},new Date(now)).routes;
  const channels=[...text.channels,...routes.filter(r=>['email','phone'].includes(r.kind)).map(r=>({companyId:company.id,kind:r.kind,value:r.value,scope:r.scope,verification:'unverified',evidence:[{id:r.id,sourceUrl:r.sourceUrl,quote:r.quote||r.value,retrievedAt:r.retrievedAt,contentHash:r.sourceHash}]}))];
  return {...text,url:address,links,channels,images:[],method:'saved_exact_public_page',networkRequests:0,sourceCache:true,sourcePageUrls:[page.url]};
}
