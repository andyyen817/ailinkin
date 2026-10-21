import {socialPlatform} from './platform-catalog.mjs';
import {browserPlatformUrl} from './browser-contact-policy.mjs';
import {hash} from './core.mjs';
const norm=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
function personPath(platform,u){
  if(platform==='LinkedIn')return /^\/in\/[^/]+\/?$/.test(u.pathname);
  if(platform==='Reddit')return /^\/(?:user|u)\/[^/]+\/?$/.test(u.pathname);
  if(platform==='小红书')return /^\/user\/profile\/[^/]+\/?$/.test(u.pathname);
  if(platform==='TikTok'||platform==='Threads')return /^\/@[^/]+\/?$/.test(u.pathname);
  if(platform==='FB'&&u.pathname==='/profile.php')return !!u.searchParams.get('id');
  return ['FB','IG','X'].includes(platform)&&/^\/[\p{L}\p{N}_.-]+\/?$/u.test(u.pathname)&&!/^\/(?:p|reel|explore|accounts|login|search|help|groups|pages|events|watch|about|home|jobs)\/?$/i.test(u.pathname);
}
export function publicPersonLinks(page,company,platforms,max=2){
  if(!page.fresh||!page.blocks?.length)return [];
  const text=page.blocks.map(b=>b.text).join('\n'),names=[company.name,...(company.verifiedAliases||[])].map(norm),seen=new Set(),found=[];
  for(const link of page.links||[]){
    const name=String(link.label||'').replace(/\s+/g,' ').trim(),platform=socialPlatform(link.url);let u;
    try{u=new URL(link.url);}catch{continue;}
    if(!platforms.includes(platform)||!browserPlatformUrl(platform,u.href)||!personPath(platform,u)||u.href===page.url||seen.has(u.href))continue;
    if(!name||name.length>100||!/[\p{L}]/u.test(name)||!norm(text).includes(norm(name))||names.includes(norm(name))||/^(?:follow|following|followers|share|like|comment|see more|contact|home|about|career|jobs|sign in|log in|instagram|facebook|linkedin|关注|分享|评论)$/i.test(name))continue;
    const block=page.blocks.find(b=>norm(b.text).includes(norm(name)));if(!block)continue;
    const at=norm(block.text).indexOf(norm(name)),quote=block.text.slice(Math.max(0,at-120),at+name.length+200);
    seen.add(u.href);found.push({url:u.href,platform,personName:name,depth:1,parentUrl:page.url,
      association:{kind:'linked_from_company_source',currentEmployerVerified:false,notice:'企业来源中的关联人物链接；现任、前任及其他关系须由人物正文核实'},
      evidence:[{id:'PERSON-LINK-'+hash(JSON.stringify([page.url,u.href,name])).slice(0,24),sourceUrl:page.url,quote,retrievedAt:page.retrievedAt,contentHash:block.contentHash}]});
    if(found.length>=max)break;
  }
  return found;
}
