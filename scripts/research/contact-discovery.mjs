import {hash} from './core.mjs';
import {platformCatalog,socialPlatform} from './platform-catalog.mjs';
import {contactSourceAdmission} from './contact-source-relevance.mjs';
const normalize=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export const discoveryVersion='observed-contact-links-v4';
export function researchAddress(raw,platform){
  try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
    if(platform!=='网页'&&socialPlatform(u.href)!==platform)return null;
    if(platform!=='网页'&&!u.pathname.replaceAll('/','')||/(?:^|\/)(?:login|signin|signup|register|my-account|sharer|share|dialog|intent|search|settings|privacy)(?:\/|$)/i.test(u.pathname))return null;
    if(/\.(?:mp4|webm|jpg|png|gif|pdf)(?:$)/i.test(u.pathname))return null;
    const allowed=platform==='网页'?['page','id','lang']:u.pathname==='/profile.php'?['id']:[];
    const query=[...u.searchParams].filter(([k,v])=>allowed.includes(k)&&v.length<=120&&/^[\p{L}\p{N}_. -]+$/u.test(v));
    u.hash='';u.search='';for(const [k,v] of query)u.searchParams.append(k,v);
    u.pathname=u.pathname.replace(/\/+$/,'');return u.href;
  }catch{return null;}
}
export function discoveryPermitted(scope,unit,batch){
  if(scope.allowedUrls?.includes(unit.url))return true;
  const p=scope.publicDiscovery;
  if(!p||!p.companyIds.includes(unit.companyId)||!batch.companyIds.includes(unit.companyId)||!p.platforms.includes(unit.platform))return false;
  if(!unit.discovery||!unit.account?.evidence?.length||unit.depth>p.maxDepth||researchAddress(unit.url,unit.platform)!==unit.url)return false;
  if(unit.platform==='网页'){
    try{if(new URL(unit.url).origin!==new URL(unit.discovery.companyWebsite).origin){
      const parent=batch.units.find(u=>u.id===unit.discovery.parentUnitId&&u.companyId===unit.companyId&&scope.allowedQueries.includes(u.query));
      if(p.allowExternalReferences&&unit.discovery.source==='search_result'&&parent&&unit.account.evidence.some(e=>researchAddress(e.sourceUrl,'网页')===unit.url))return true;
      const linkedRoot=scope.allowedUrls.find(raw=>new URL(raw).origin===new URL(unit.url).origin&&new URL(raw).pathname==='/');
      if(!linkedRoot||!unit.account.evidence.some(e=>e.sourceUrl===linkedRoot))return false;
    }}catch{return false;}
  }
  return true;
}
export function discoveryCandidates(unit,items,company,fromPage=false){
  const names=[company.name,...(company.verifiedAliases||[])].map(normalize).filter(Boolean),found=new Map();
  for(const hit of items||[]){
    const text=String(hit.snippet||hit.label||''),platform=socialPlatform(hit.url)||(fromPage?'网页':unit.platform),url=researchAddress(hit.url,platform);
    if(!url||(!fromPage&&platform!==unit.platform))continue;
    const admission=contactSourceAdmission(company,{...hit,snippet:text});
    if(admission.state==='rejected'||!fromPage&&admission.state!=='admitted')continue;
    const companyMention=admission.companyMatch;
    const personMention=unit.personName&&normalize(text).includes(normalize(unit.personName));
    if(!fromPage&&!companyMention&&!personMention)continue;
    if(fromPage){
      const ownPath=new URL(url).origin===new URL(unit.url).origin&&new URL(url).pathname.startsWith(new URL(unit.url).pathname+'/');
      const relevant=/about|contact|team|people|staff|leadership|founder|management|board|profil|tentang|kontak|story|pressroom|corporate|investor/i.test(text+' '+new URL(url).pathname);
      if(!companyMention&&!relevant&&!ownPath)continue;
    }
    const evidence={id:'CD-'+hash(JSON.stringify([unit.id,url,text])).slice(0,24),sourceUrl:fromPage?unit.url:hit.url,
      quote:fromPage?text+' → '+hit.url:text,retrievedAt:new Date().toISOString(),contentHash:hash(text)};
    found.set(url,{companyId:company.id,platform,url,ownership:'unconfirmed',ownerType:'unknown',evidence:[evidence],
      readState:'not_started',identityNotice:'有来源的研究页面；账号主体及人员关系待核实',discovery:{parentUnitId:unit.id,source:fromPage?'page_link':'search_result',companyWebsite:company.website}});
  }
  const priority=a=>/the.board|senior.management|leadership|founder|team/i.test(a.evidence[0].quote)?0:/people|corporate/i.test(a.evidence[0].quote)?1:/story|pressroom|about/i.test(a.evidence[0].quote)?2:3;
  return [...found.values()].sort((a,b)=>priority(a)-priority(b)).slice(0,8);
}
export function appendDiscovery(batch,unit,accounts,scope){
  const p=scope.publicDiscovery;if(!p)return 0;let added=0;
  for(const account of accounts){
    const depth=(unit.depth||0)+1;
    if(depth>p.maxDepth||!p.platforms.includes(account.platform)||batch.units.some(u=>u.companyId===unit.companyId&&u.url===account.url))continue;
    const siblings=batch.units.filter(u=>u.companyId===unit.companyId&&u.url);
    if(siblings.length>=p.maxPagesPerCompany||siblings.filter(u=>u.platform===account.platform).length>=p.maxPagesPerPlatform||added>=p.maxChildrenPerPage)break;
    const next={id:'CU-'+hash(JSON.stringify([unit.companyId,account.platform,account.url])).slice(0,24),companyId:unit.companyId,
      companyName:unit.companyName,platform:account.platform,url:account.url,account,depth,discovery:account.discovery,state:'pending',reason:'继续核实已观察到的关联页面'};
    if(!discoveryPermitted(scope,next,batch))continue;batch.units.push(next);added++;
  }
  return added;
}
export function staffQuery(companyName,platform){
  const name='"'+String(companyName).replace(/["\r\n]/g,' ').trim()+'"',domain=platformCatalog[platform]?.domains[0];
  return `${name}${domain?' site:'+domain:''} (people OR team OR staff OR founder OR former OR partner)`;
}
