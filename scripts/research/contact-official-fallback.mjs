import {contactText} from './contact-text-extractor.mjs';
import {companyContactRoutes} from './company-contact-routes.mjs';
export function savedOfficialContactPage(data,company,now=Date.now()){
  const entity=data.sourcePipeline?.entities?.find(e=>e.companyId===company.id&&e.ownership?.verified);
  if(!entity)return null;
  const host=new URL(company.website).hostname.replace(/^www\./,'');
  const pages=(entity.websitePages||[]).filter(p=>{
    try{return new URL(p.url).hostname.replace(/^www\./,'')===host&&typeof p.content==='string'&&p.content.trim().length>20&&
      Date.parse(p.retrievedAt)<=now&&now-Date.parse(p.retrievedAt)<=30*86400000;}catch{return false;}
  }).slice(0,16);
  if(!pages.length)return null;
  const blocks=[],links=[];
  for(const p of pages){const remaining=32000-blocks.reduce((n,b)=>n+b.text.length,0);if(remaining<=0||blocks.length>=8)break;
    const part=contactText({url:p.url,text:p.content,companyId:company.id,retrievedAt:p.retrievedAt,maxCharacters:remaining,maxBlocks:8-blocks.length});blocks.push(...part.blocks);links.push(...(p.linkDetails||p.links||[]));}
  const routes=companyContactRoutes({...entity,websitePages:pages},new Date(now));
  const channels=routes.routes.filter(r=>['email','phone'].includes(r.kind)).map(r=>({companyId:company.id,kind:r.kind,value:r.value,scope:r.scope,
    verification:'unverified',evidence:[{id:r.id,sourceUrl:r.sourceUrl,quote:r.quote||r.value,retrievedAt:r.retrievedAt,contentHash:r.sourceHash}]}));
  return {state:blocks.length?'read':'empty',url:company.website,blocks,channels,links,images:[],method:'saved_official_website',networkRequests:0,
    sourcePageUrls:pages.map(p=>p.url),coverage:{complete:false,charactersRead:blocks.reduce((n,b)=>n+b.text.length,0),scope:'saved_verified_official_pages',reason:'saved_evidence_only_not_all_social_history'}};
}
