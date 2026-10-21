import {browserPlatformUrl} from './browser-contact-policy.mjs';
import {publicPersonLinks} from './public-person-links.mjs';
import {hash} from './core.mjs';
export function savedDiscoverySources(history,company,platforms){
  const sources=new Map();
  for(const job of history.filter(j=>j.companyId===company.id))for(const page of job.page?.pages||[]){
    if(!page.fresh||!page.blocks?.length||page.sourceType!=='social_body')continue;
    for(const person of publicPersonLinks(page,company,platforms,4)){
      const id='PD-'+hash(JSON.stringify([company.id,page.url,person.url])).slice(0,24);
      sources.set(person.url,{...person,id,companyId:company.id,kind:'person'});
    }
    if(!platforms.includes('IG')||page.platform!=='IG'||!browserPlatformUrl('IG',page.url))continue;
    const handle=new URL(page.url).pathname.split('/')[1];
    for(const link of page.links||[]){
      if(!browserPlatformUrl('IG',link.url))continue;
      const u=new URL(link.url),post=/^\/([A-Za-z0-9_.]+)\/p\/[A-Za-z0-9_-]+\/?$/.exec(u.pathname);if(!post||post[1]!==handle||u.search||u.hash)continue;
      const id='PD-'+hash(JSON.stringify([company.id,page.url,link.url])).slice(0,24),block=page.blocks[0];
      sources.set(link.url,{id,companyId:company.id,kind:'post',platform:'IG',url:link.url,depth:0,parentUrl:page.url,
        label:String(link.label||''),association:{kind:'linked_from_company_profile',employmentVerified:false},
        evidence:[{id,sourceUrl:page.url,quote:link.label||link.url,observedUrl:link.url,retrievedAt:page.retrievedAt,contentHash:block.contentHash,type:'observed_link'}]});
    }
  }
  return [...sources.values()];
}
