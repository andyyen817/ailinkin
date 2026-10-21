import {savedDiscoverySources} from './public-discovery-sources.mjs';
import {publicPersonLinks} from './public-person-links.mjs';
import {readPublicContactPage} from './public-page-contact.mjs';
import {searchPublicWeb,publicSearchCache} from './public-search-browser.mjs';
import {browserPlatformUrl} from './browser-contact-policy.mjs';
import {hash} from './core.mjs';
const barriers=new Set(['robots_denied','restricted','needs_login','rate_limited','needs_user_action','robots_unknown']);
/** @param {any} s @param {any} company @param {{history?:any[],personName?:string,checkpoint?:(r:any)=>Promise<any>,read?:Function,search?:Function}} options */
export async function runPersonDiscovery(s,company,{history=[],personName='',checkpoint=async()=>{},read=readPublicContactPage,search=searchPublicWeb}={}){
  if(personName&&!s.scope.discoveryPersonNames?.includes(personName))throw Error('PERSON_DISCOVERY_NAME_OUTSIDE_SCOPE');
  if(!s.anonymous||s.busy||!s.scope.discoverySourceUrls?.length)throw Error('PERSON_DISCOVERY_SCOPE_REQUIRED');s.busy=true;s.manual=false;
  const prior=history.filter(j=>j.companyId===company.id),oldPages=prior.flatMap(j=>j.page?.pages||[]),oldSearches=prior.flatMap(j=>j.page?.searches||[]);
  const attempted=new Set(prior.filter(j=>j.scopeId===s.scope.id).flatMap(j=>j.page?.discoveryAttempts||[]).map(a=>a.url));
  const stopped=new Set(prior.filter(j=>j.scopeId===s.scope.id).flatMap(j=>j.page?.pausedSources||[])),seen=new Set();
  const result={state:'no_new_public_material',fresh:false,method:'anonymous_public_browser',sourceType:'social_body',pages:[],searches:[],blocks:[],channels:[],images:[],discoveryAttempts:[],pausedSources:[],coverageRows:[]};
  const save=async()=>{result.pausedSources=[...stopped];await checkpoint(result);};
  const budget=()=>Date.now()<s.expiresAt&&s.usage.pageReads<s.scope.maxPageReads&&s.usage.networkRequests<s.scope.maxNetworkRequests;
  s.beforePublicRequest=async p=>{result.searches.push({...p,state:'pending_unknown'});await save();};
  async function consume(target){
    if(seen.has(target.url))return;seen.add(target.url);
    if(oldPages.some(p=>p.url===target.url&&p.fresh&&p.blocks?.length)){result.coverageRows.push({url:target.url,platform:target.platform,state:'reused',newPages:0});return;}
    if(attempted.has(target.url)||stopped.has(new URL(target.url).hostname)||!budget()){result.coverageRows.push({url:target.url,platform:target.platform,state:'not_covered',newPages:0});return;}
    attempted.add(target.url);result.discoveryAttempts.push({url:target.url,sourceId:target.id||null,state:'pending',at:new Date().toISOString()});await save();
    s.platform=target.platform;
    if(s.scope.discoveryPreviewUrls?.includes(target.url)){s.singlePublicPreviewAuthorizedUrl=target.url;s.publicPreviewUsed=false;}
    else delete s.singlePublicPreviewAuthorizedUrl;
    const page=await read(s,company,target,{personName:target.personName||personName});delete s.singlePublicPreviewAuthorizedUrl;
    const {images=[],...record}=page;result.pages.push({...record,url:record.url||target.url,platform:target.platform,depth:target.depth||0,parentUrl:target.parentUrl||null,association:target.association||null});
    result.discoveryAttempts.at(-1).state=page.state;
    if(page.fresh){result.fresh=true;result.blocks.push(...(page.blocks||[]));result.channels.push(...(page.channels||[]));result.images.push(...images);result.url||=page.url;result.retrievedAt=page.retrievedAt;}
    if(barriers.has(page.state))stopped.add(new URL(target.url).hostname);
    result.coverageRows.push({url:target.url,platform:target.platform,state:page.state,newPages:page.fresh?1:0});await save();
    if(page.fresh&&!target.depth)for(const person of publicPersonLinks(page,company,s.scope.platforms,2))await consume(person);
  }
  try{
    const sources=savedDiscoverySources(prior,company,s.scope.platforms).filter(t=>s.scope.discoverySourceUrls.includes(t.url));
    for(const source of sources)await consume(source);
    if(personName&&s.scope.platforms.includes('LinkedIn')){
      const plans=s.scope.engines.map(engine=>({engine,platform:'LinkedIn',query:personName+' '+company.name}));
      if(s.scope.engines.includes('LangSearch'))plans.push({engine:'LangSearch',platform:'LinkedIn',query:personName});
      for(const plan of plans){
        if(oldSearches.some(q=>q.engine===plan.engine&&q.query===plan.query&&(q.state==='pending_unknown'||q.state==='unknown'||q.reason==='free_index_result_unknown_no_retry')))continue;
        const cached=publicSearchCache(plan,oldSearches);
        if(!budget()||!cached&&(stopped.has(plan.engine)||s.usage.searchQueries>=s.scope.maxSearchQueries))continue;
        const response=cached?{...cached,reused:true}:await search(s,plan,oldSearches);
        const pending=result.searches.findIndex(q=>q.key===response.key&&q.state==='pending_unknown');if(pending>=0)result.searches[pending]=response;else result.searches.push(response);
        if(barriers.has(response.state)||response.state==='upstream_unavailable')stopped.add(plan.engine);await save();
        let matched=false;
        for(const item of (response.results||[]).slice(0,10)){
          if(!browserPlatformUrl('LinkedIn',item.url)||!/^\/in\/[^/]+\/?$/.test(new URL(item.url).pathname)||
            ![item.title,item.snippet].join(' ').normalize('NFKC').toLowerCase().includes(personName.normalize('NFKC').toLowerCase()))continue;
          const n=result.pages.length;await consume({url:item.url,platform:'LinkedIn',personName,depth:1,parentUrl:response.url,
            association:{kind:'name_query_candidate',identityVerified:false,employmentVerified:false},
            evidence:[{sourceUrl:response.url,quote:item.snippet||item.title,retrievedAt:response.retrievedAt,type:'search_snippet'}]});
          matched||=result.pages.slice(n).some(p=>p.fresh);if(matched)break;
        }
        if(matched)break;
      }
    }
    result.blocks=[...new Map(result.blocks.map(b=>[b.contentHash,b])).values()].slice(0,16).map(b=>({...b,text:b.text.slice(0,4000)}));result.images=result.images.slice(0,4);
    result.contentKey=hash(JSON.stringify(result.pages.filter(p=>p.fresh).map(p=>[p.url,p.blocks?.map(b=>b.contentHash)])));
    result.coverage={complete:false,charactersRead:result.blocks.reduce((n,b)=>n+b.text.length,0),reason:'finite_observed_posts_and_named_person_discovery'};
    result.state=result.fresh?'read':result.coverageRows.some(c=>c.state==='reused')?'reused':'no_new_public_material';await save();return result;
  }finally{s.busy=false;s.manual=false;delete s.beforePublicRequest;delete s.singlePublicPreviewAuthorizedUrl;}
}
