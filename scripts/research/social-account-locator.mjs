import {createHash} from 'node:crypto';
import {socialPlatform,platformCatalog} from './platform-catalog.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const host=v=>new URL(v).hostname.toLowerCase().replace(/^www\./,'');
export function accountUrl(raw){
  const platform=socialPlatform(raw);if(!platform)return null;
  const u=new URL(raw),parts=u.pathname.split('/').filter(Boolean);
  if(!parts.length||/^(sharer|share|plugins|dialog|login|intent|search|help|p|reel|reels|stories)$/i.test(parts[0]))return null;
  if(platform==='LinkedIn'&&!['company','in','school'].includes(parts[0]))return null;
  if(platform==='Reddit'&&!['r','u','user'].includes(parts[0]))return null;
  u.hostname=platformCatalog[platform].canonical;u.hash='';
  const profileId=u.pathname==='/profile.php'?u.searchParams.get('id'):null;u.search='';
  if(u.pathname==='/profile.php'&&!profileId)return null;
  if(profileId)u.searchParams.set('id',profileId);
  u.pathname=u.pathname.replace(/\/+$/,'');
  return {platform,url:u.href};
}
export function cachedSocialAccounts(entity,company,platforms,now=Date.now()){
  if(!entity?.ownership?.verified||entity.companyId!==company.id)throw Error('OFFICIAL_BUYER_REQUIRED');
  const found=new Map();
  for(const page of entity.websitePages||[]){
    try{
      if(!page.content||host(page.url)!==host(entity.ownership.url)||!page.retrievedAt||!Number.isFinite(Date.parse(page.retrievedAt))||Date.parse(page.retrievedAt)>now)continue;
      const links=[...(page.linkDetails||[]),...(page.links||[]).map(url=>({url,label:''}))];
      for(const m of page.content.matchAll(/https?:\/\/[^\s<>"')\]]+/g))links.push({url:m[0],label:''});
      for(const link of links){
        const candidate=accountUrl(link.url);if(!candidate||!platforms.includes(candidate.platform))continue;
        const key=candidate.platform+':'+candidate.url,contentHash=hash(page.content);
        const evidence={id:'social-link-'+hash([page.url,link.url,contentHash]).slice(0,24),sourceUrl:page.url,
          quote:(link.label?link.label+' → ':'')+link.url,retrievedAt:page.retrievedAt,contentHash};
        const existing=found.get(key);
        if(existing){if(!existing.evidence.some(e=>e.id===evidence.id))existing.evidence.push(evidence);continue;}
        found.set(key,{companyId:company.id,...candidate,ownership:'official_link',ownerType:'unknown',
          evidence:[evidence],readState:'not_started',identityNotice:'官网保存页面指向的账号候选；账号归属与人员尚未复核',sourceExpired:now-Date.parse(page.retrievedAt)>30*86400000});
      }
    }catch{continue;}
  }
  return [...found.values()].sort((a,b)=>a.url.localeCompare(b.url));
}
export function socialQueries(company,platforms,accounts){
  return platforms.filter(p=>p!=='网页'&&!accounts.some(a=>a.platform===p)).map(platform=>({platform,
    query:'site:'+platformCatalog[platform].canonical+' '+JSON.stringify(String(company.name)),
    reason:'已保存官网尚无该平台账号，后续需在批准范围内查询；没有推测域名',excludeDomains:[],status:'not_requested'}));
}
export function socialPlanBasis(company,platforms,accounts,queries){
  return hash([1,company.id,company.name,company.website,[...platforms].sort(),accounts.map(a=>[a.platform,a.url,a.evidence.map(e=>[e.sourceUrl,e.quote,e.contentHash])]),[...queries].sort((a,b)=>a.platform.localeCompare(b.platform))]);
}
