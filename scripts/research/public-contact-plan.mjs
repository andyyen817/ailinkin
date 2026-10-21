import {platformCatalog} from './platform-catalog.mjs';
import {browserPlatformUrl} from './browser-contact-policy.mjs';
import {searchPublicWeb,publicSearchCache} from './public-search-browser.mjs';
import {readPublicContactPage} from './public-page-contact.mjs';
import {hash} from './core.mjs';
import {publicSourceRecovery,officialCompanyLabel} from './public-source-recovery.mjs';
import {contactSourceAdmission} from './contact-source-relevance.mjs';
import {publicPersonLinks} from './public-person-links.mjs';
import {observedAccountEntry,approvedPreflightRetry,approvedPublicPreview} from './public-account-entry.mjs';
const barrier=new Set(['restricted','needs_login','rate_limited','robots_denied','robots_unknown','needs_user_action']);
export function publicContactPlan(company,platforms,personName=''){
  return platforms.map(platform=>({platform,query:personName?`"${personName}" "${officialCompanyLabel(company)}" site:${platform==='LinkedIn'?'linkedin.com/in/':platformCatalog[platform]?.canonical}`:
    `"${officialCompanyLabel(company)}" site:${platformCatalog[platform]?.canonical}`,purpose:'public_company_people_and_channels'}));
}
export function publicSourceKey(url){const u=new URL(url);u.hash='';for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_')||['ref','source','igshid'].includes(k))u.searchParams.delete(k);return u.href;}
/** @param {any} s @param {any} company @param {{accounts?:any[],personName?:string,preferredPlatform?:string,directOnly?:boolean,history?:any[],checkpoint?:(result:any)=>Promise<any>,search?:(s:any,plan:any,cached?:any[])=>Promise<any>,read?:(s:any,company:any,target:any,options?:any)=>Promise<any>}} options */
export async function runPublicContactBatch(s,company,{accounts=[],personName='',preferredPlatform='',directOnly=false,history=[],checkpoint=async(_result={})=>{},search=searchPublicWeb,read=readPublicContactPage}={}){
  if(!s.anonymous||s.busy)throw Error('ANONYMOUS_BATCH_REQUIRED_OR_BUSY');s.busy=true;s.manual=false;
  const prior=history.filter(j=>j.companyId===company.id),searches=prior.flatMap(j=>j.page?.searches||[]),saved=prior.flatMap(j=>j.page?.pages||[]);
  const seen=new Set(saved.filter(p=>p.fresh&&p.blocks?.length).map(p=>publicSourceKey(p.url))),attemptedUrls=new Set();
  const stopped=new Set(prior.filter(j=>j.scopeId===s.scope.id).flatMap(j=>[...(j.page?.pausedSources||[]),...(j.page?.searches||[]).filter(q=>q.state==='pending_unknown').map(q=>q.engine)]));
  const result={state:'read_partial',fresh:false,method:'anonymous_public_browser',sourceType:'social_body',pages:[],searches:[],coverageRows:[],blocks:[],channels:[],images:[],pausedSources:[],searchSubmitted:false};
  if(publicSourceRecovery(prior,s.scope.id,'LangSearch').allowRecovery){stopped.delete('LangSearch');result.recovery={engine:'LangSearch',knownResponse:true,maxUpstreamFailures:2,originalsRetained:true};}
  const save=async()=>{result.pausedSources=[...stopped].filter(Boolean);await checkpoint(result);};
  s.beforePublicRequest=async pending=>{result.searches.push({...pending,state:'pending_unknown'});await save();};
  async function consume(platform,target){
    const key=publicSourceKey(target.url);if(seen.has(key))return {state:'reused',url:target.url,fresh:false};
    if(stopped.has(new URL(target.url).hostname))return {state:'source_paused',fresh:false,url:target.url};
    const failures=saved.filter(p=>publicSourceKey(p.url)===key&&!p.fresh&&p.state==='read_failed').length;
    if(attemptedUrls.has(key)||failures>=2)return {state:'retry_limit',url:target.url,fresh:false};attemptedUrls.add(key);
    s.platform=platform;const page=await read(s,company,target,{personName:target.personName||personName});const {images=[],...record}=page;result.pages.push({...record,url:record.url||target.url,platform,depth:target.depth||0,parentUrl:target.parentUrl||null,association:target.association||null});
    if(page.fresh){result.fresh=true;result.blocks.push(...(page.blocks||[]));result.channels.push(...(page.channels||[]));result.images.push(...images);result.url||=page.url;result.retrievedAt=page.retrievedAt;}
    if(barrier.has(page.state))stopped.add(new URL(target.url).hostname);await save();return page;
  }
  async function peopleFrom(page){
    if(!page.fresh||page.depth)return;
    for(const person of publicPersonLinks(page,company,s.scope.platforms,2)){
      if(Date.now()>=s.expiresAt||s.usage.pageReads>=s.scope.maxPageReads||s.usage.networkRequests>=s.scope.maxNetworkRequests)break;
      const material=await consume(person.platform,person);material.depth=person.depth;
    }
  }
  const order=directOnly||personName?[preferredPlatform]:preferredPlatform&&s.scope.platforms.includes(preferredPlatform)?[preferredPlatform,...s.scope.platforms.filter(p=>p!==preferredPlatform)]:s.scope.platforms;
  try{for(const plan of publicContactPlan(company,order,personName)){
    if(Date.now()>=s.expiresAt||s.usage.networkRequests>=s.scope.maxNetworkRequests||s.usage.pageReads>=s.scope.maxPageReads){result.coverageRows.push({platform:plan.platform,state:'not_covered',reason:'budget_or_deadline'});continue;}
    const known=(personName&&!directOnly?[]:accounts).filter(a=>a.platform===plan.platform&&a.evidence?.length&&browserPlatformUrl(plan.platform,a.url)).slice(0,1).map(observedAccountEntry);
    if(directOnly&&known[0]&&approvedPublicPreview(s.scope,known[0],prior)){
      result.publicPreviewAttempt={url:known[0].url,phase:'pending_single_public_contrast',at:new Date().toISOString()};
      await save();s.singlePublicPreviewAuthorizedUrl=known[0].url;s.publicPreviewUsed=false;
      s.robots.delete(new URL(known[0].url).origin);stopped.delete(new URL(known[0].url).hostname);
    }
    if(directOnly&&known[0]&&approvedPreflightRetry(s.scope,known[0],prior)){
      result.preflightRetry={url:known[0].url,reason:'scope_approved_single_known_preflight_diagnostic'};await save();stopped.delete(new URL(known[0].url).hostname);
    }
    let successful=false,attempted=false;
    for(const a of known){if(stopped.has(new URL(a.url).hostname)&&!seen.has(publicSourceKey(a.url)))continue;attempted=true;const page=await consume(plan.platform,a);successful||=!!page.fresh||page.state==='reused';await peopleFrom(page);}
    if(!successful&&!directOnly)for(const engine of s.scope.engines){
      const specification=engine==='LangSearch'&&plan.platform===preferredPlatform?{...plan,query:plan.platform==='LinkedIn'&&personName?personName+' '+company.name:officialCompanyLabel(company)}:plan;
      const cached=publicSearchCache({...specification,engine},searches);
      if(!cached&&(stopped.has(engine)||s.usage.searchQueries>=s.scope.maxSearchQueries))continue;
      if(engine==='LangSearch'&&!cached){const recovery=publicSourceRecovery([...prior,{scopeId:s.scope.id,page:result}],s.scope.id,engine);
        if(recovery.stop){stopped.add(engine);continue;}if(recovery.failedQueries.includes(specification.query))continue;
        const wait=Math.max(0,recovery.readyAt-Date.now());if(wait>30000||Date.now()+wait>=s.expiresAt){stopped.add(engine);continue;}if(wait)await s.page.waitForTimeout(wait);}
      const response=cached?{...cached,reused:true}:await search(s,{...specification,engine},searches);const pending=result.searches.findIndex(q=>q.key===response.key&&q.state==='pending_unknown');if(pending>=0)result.searches[pending]=response;else result.searches.push(response);attempted=true;
      if(barrier.has(response.state)||response.state==='upstream_unavailable'&&publicSourceRecovery([...prior,{scopeId:s.scope.id,page:result}],s.scope.id,engine).stop)stopped.add(engine);await save();
      const admitted=(response.results||[]).map(v=>({...v,admission:contactSourceAdmission({...company,verifiedAliases:[...(company.verifiedAliases||[]),officialCompanyLabel(company)]},v)}));
      response.results=admitted;
      const candidates=response.state==='read'?admitted.filter(v=>!stopped.has(new URL(v.url).hostname)&&browserPlatformUrl(plan.platform,v.url)&&(v.admission.state==='admitted'||personName&&[v.title,v.snippet].join(' ').toLowerCase().includes(personName.toLowerCase()))).slice(0,2):[];
      for(const candidate of candidates){const evidence=[{sourceUrl:response.url,quote:candidate.snippet,retrievedAt:response.retrievedAt,type:'search_snippet'}];
        const page=await consume(plan.platform,{url:candidate.url,evidence});successful||=!!page.fresh||page.state==='reused';await peopleFrom(page);if(successful)break;}
      if(successful)break;
    }
    const pages=result.pages.filter(p=>p.platform===plan.platform),sourceFailure=result.searches.filter(p=>p.platform===plan.platform&&(barrier.has(p.state)||p.state==='upstream_unavailable')).at(-1);
    const state=successful?(pages.some(p=>p.fresh)?'read_partial':'reused'):pages.at(-1)?.state||sourceFailure?.state||(!attempted?'not_covered':'no_related_public_body');
    result.coverageRows.push({platform:plan.platform,state,notice:'仅代表本批公开入口；未取得不代表没有人员',newPages:pages.filter(p=>p.fresh).length});await save();
  }
    result.searchSubmitted=s.events.some(e=>e.action==='public_search_submitted');
    result.blocks=[...new Map(result.blocks.map(b=>[b.contentHash,b])).values()].slice(0,16).map(b=>({...b,text:b.text.slice(0,4000)}));
    result.images=result.images.slice(0,4);result.contentKey=hash(JSON.stringify(result.pages.filter(p=>p.fresh).map(p=>[p.url,p.blocks?.map(b=>b.contentHash)])));
    result.coverage={complete:false,charactersRead:result.blocks.reduce((n,b)=>n+b.text.length,0),reason:'finite_public_batch'};
    result.state=result.fresh?'read':result.coverageRows.some(row=>row.state==='reused')?'reused':'no_new_public_material';await save();return result;
  }finally{s.busy=false;s.manual=false;delete s.beforePublicRequest;delete s.singlePublicPreviewAuthorizedUrl;}
}
