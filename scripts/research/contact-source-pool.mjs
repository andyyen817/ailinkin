import {hash} from './core.mjs';
import {savedOfficialContactPage} from './contact-official-fallback.mjs';
import {plainTextEmails} from './contact-detail-fields.mjs';
import {contactSourceAdmission,contactAdmissionVersion,differentEmployerNames} from './contact-source-relevance.mjs';
export const poolVersion='company-contact-pool-v2-provenance';
export const contactPoolOptions=(scope,companyId)=>scope?.modelSources?{sourceUrls:scope.modelSources.find(s=>s.companyId===companyId)?.urls||[]}:{ };
/** Gather saved sources only; never fetch or infer employment/contact ownership. */
export function collectContactPool(data,company,now=Date.now(),{sourceUrls}={}){
  const blocks=new Map(),images=new Map(),channels=new Map(),origins=[],admissions=[];
  const differentEmployers=differentEmployerNames(data,company);
  const fresh=v=>Number.isFinite(Date.parse(v))&&Date.parse(v)<=now&&now-Date.parse(v)<=30*86400000;
  function addPage(page,platform,runId){
    if(!page||['empty'].includes(page.state))return;
    let admittedPage=false;
    for(const b of page.blocks||[]){
      if(!b.text?.trim()||!fresh(b.retrievedAt))continue;
      let url;try{url=new URL(b.sourceUrl);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)continue;}catch{continue;}
      if(sourceUrls&&(!sourceUrls.includes(url.href)||page.method==='search_snippet'))continue;
      const admission=contactSourceAdmission(company,b,{differentEmployers});
      admissions.push({sourceUrl:b.sourceUrl,originalId:b.id,...admission});
      if(admission.state!=='admitted')continue;
      admittedPage=true;
      const contentHash=hash(b.text),key=hash(JSON.stringify([url.href,contentHash]));
      const sourceType=page.method==='search_snippet'?'search_snippet':platform==='网页'?'website_body':'social_body';
      if(!blocks.has(key))blocks.set(key,{...b,id:'POOL-'+key.slice(0,24),contentHash,sourceType});
      for(const c of plainTextEmails([{...b,contentHash}]))channels.set(JSON.stringify([c.scope,c.personId,c.kind,c.value]),c);
      origins.push({key,sourceUrl:url.href,platform,runId,originalId:b.id});
    }
    if(admittedPage){
      for(const i of page.images||[]){if(i.imageId&&i.contentHash&&fresh(i.retrievedAt))images.set(i.sourceUrl+':'+i.contentHash,i);}
      for(const c of page.channels||[]){if(c.value&&c.evidence?.length)channels.set(JSON.stringify([c.scope,c.personId,c.kind,c.value]),c);}
    }
  }
  const official=savedOfficialContactPage(data,company,now);if(official)addPage(official,'网页','saved-official');
  for(const r of data.contactResearchRuns||[]){
    if(r.companyId!==company.id||r.state!=='done'||r.page?.method==='company_source_pool'||r.requests?.some(q=>['unknown','pending'].includes(q.status)))continue;
    addPage({...r.page,images:r.images,channels:r.channels},r.fallbackUsed||r.page?.method==='saved_official_website'?'网页':r.platform,r.id);
  }
  const name=company.name.normalize('NFKC').toLowerCase();
  for(const s of data.contactSearchEvidence||[]){
    if(s.companyId!==company.id||!s.quote||!s.quote.normalize('NFKC').toLowerCase().includes(name))continue;
    addPage({method:'search_snippet',blocks:[{id:s.id,text:s.quote,sourceUrl:s.sourceUrl,retrievedAt:s.retrievedAt}],channels:[]},s.platform,s.id);
  }
  const all=[...blocks.values()].sort((a,b)=>Date.parse(b.retrievedAt)-Date.parse(a.retrievedAt)||a.id.localeCompare(b.id));
  const picked=[],omitted=[];let chars=0;
  for(const b of all){if(picked.length>=16||chars+b.text.length>64000){omitted.push(b.id);continue;}picked.push(b);chars+=b.text.length;}
  picked.sort((a,b)=>a.id.localeCompare(b.id));const allImages=[...images.values()].sort((a,b)=>a.id.localeCompare(b.id)),chosenImages=allImages.slice(0,4);
  const included=new Set(picked.map(b=>b.id.slice(5)));
  return {version:poolVersion,companyId:company.id,blocks:picked,images:chosenImages,channels:[...channels.values()],origins,
    coverage:{complete:false,sourcePlatforms:[...new Set(origins.map(o=>o.platform))].sort(),uniqueBlocks:all.length,analyzedBlocks:picked.length,
      admissions,admissionVersion:contactAdmissionVersion,
      characters:chars,omittedBlocks:omitted,omittedImages:allImages.length-chosenImages.length,notice:'仅汇总已保存的公开证据；任职、采购权及完整覆盖仍需核实。'},
    digest:hash(JSON.stringify([poolVersion,contactAdmissionVersion,company.id,company.name,company.website,picked.map(b=>[b.id,b.contentHash]),chosenImages.map(i=>[i.id,i.contentHash])]))};
}
