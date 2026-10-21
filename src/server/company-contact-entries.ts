import {socialPlatform} from '../../scripts/research/platform-catalog.mjs';
import {browserPlatformUrl} from '../../scripts/research/browser-contact-policy.mjs';
const host=(value:string)=>{try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}};
export function publicAccountUrl(raw:string){
  try{const u=new URL(raw),platform=socialPlatform(u.href);
    if(['youtube.com','www.youtube.com'].includes(u.hostname)){
      if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||!/^\/(?:@[^/?#]+|(?:c|channel|user)\/[A-Za-z0-9_-]+)\/?$/.test(u.pathname))return '';
      u.hostname='youtube.com';u.search='';u.hash='';u.pathname=u.pathname.replace(/\/$/,'');return u.href;
    }
    if(!platform||!browserPlatformUrl(platform,u.href)||/^\/(?:share|sharer|intent|help|developers|login|search)(?:[/.]|$)/i.test(u.pathname))return '';
    u.hostname=u.hostname.replace(/^www\./,'');if(u.hostname==='twitter.com')u.hostname='x.com';
    u.hash='';for(const k of [...u.searchParams.keys()])if(k!=='id')u.searchParams.delete(k);
    if(u.pathname==='/')return '';u.pathname=u.pathname.replace(/\/$/,'');return u.href;
  }catch{return '';}
}
/** Project only recorded official-site links and evidence-bearing planned accounts. No new network request. */
export function companyContactEntries(data:any,company:any){
  const found=new Map<string,any>(),domain=host(company.website||'');
  const add=(raw:string,ev:any[])=>{const value=publicAccountUrl(raw);if(!value||!ev?.length)return;
    const old=found.get(value),evidence=[...new Map([...(old?.evidence||[]),...ev].map(e=>[JSON.stringify(e),e])).values()];
    found.set(value,{kind:'social',value,scope:'company',ownership:'company_source_link',verification:'ownership_needs_review',
      platform:socialPlatform(value),evidence});};
  for(const plan of data.contactResearchPlans||[])for(const c of plan.companies||[])if(c.companyId===company.id)
    for(const a of c.accounts||[])if(a.ownership==='official_link'||a.evidence?.some((e:any)=>host(e.sourceUrl||'')===domain))add(a.url,a.evidence);
  if(domain)for(const request of data.requests||[]){
    const page=request.response;if(!page||host(page.url||'')!==domain||!Array.isArray(page.links))continue;
    for(const link of page.links){const url=typeof link==='string'?link:link.url;if(typeof url!=='string')continue;
      add(url,[{sourceUrl:page.url,quote:typeof link==='string'?url:[link.label,url].filter(Boolean).join(' '),
        retrievedAt:page.retrievedAt||request.finishedAt||request.createdAt,sourceType:'website_body'}]);}
  }
  return [...found.values()];
}
