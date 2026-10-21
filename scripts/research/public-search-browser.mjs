import {publicSearchUrl,browserPageState,browserPlatformUrl} from './browser-contact-policy.mjs';
import {readBrowserRobots} from './browser-contact-session.mjs';
import {robotsPolicy} from './public-page-policy.mjs';
import {hash} from './core.mjs';
import {searchPublicIndex} from './public-index-search.mjs';
export function searchTarget(raw,engine){
  try{const u=new URL(raw);let target=u.href;
    if(engine==='Google'&&['www.google.com','google.com'].includes(u.hostname))target=u.searchParams.get('q')||u.searchParams.get('url')||'';
    if(engine==='Bing'&&['www.bing.com','bing.com'].includes(u.hostname)){
      const encoded=u.searchParams.get('u')||'';target=encoded.startsWith('a1')?Buffer.from(encoded.slice(2),'base64url').toString('utf8'):'';
    }
    const result=new URL(target);if(result.protocol!=='https:'||result.username||result.password||result.port)return null;
    result.hash='';return result.href;
  }catch{return null;}
}
export async function publicRobots(s,url){
  const origin=new URL(url).origin;let record=s.robots.get(origin);
  if(!record){try{const value=await readBrowserRobots(s,url);record={...value,checked:!value.failure,at:new Date().toISOString()};}
    catch(e){record={checked:false,state:'robots_unknown',reason:String(e.message||e).split('\n')[0]};}s.robots.set(origin,record);
    if(record.checked&&record.diagnostics?.finalUrl)s.robots.set(new URL(record.diagnostics.finalUrl).origin,record);}
  const robotsEvidence={url:origin+'/robots.txt',status:record.status||null,contentHash:record.text?hash(record.text):null,
    quote:record.text?.split(/\r?\n/).filter(line=>/^user-agent:\s*\*|^(?:allow|disallow):\s*(?:\/search|\/$)/i.test(line.trim())).slice(0,12).join('\n')||'',failure:record.failure||record.reason||null,response:record.diagnostics||null};
  if(!record.checked||![200,404,410].includes(record.status))return {state:record.status===429?'rate_limited':[401,403].includes(record.status)?'restricted':'robots_unknown',reason:record.failure||'robots_response_unavailable',robotsEvidence};
  let policy;try{policy=robotsPolicy(record.status===200?record.text:'',url);}catch(e){return {state:'robots_unknown',reason:'robots_rules_invalid',robotsEvidence:{...robotsEvidence,failure:String(e.message||e).split('\n')[0]}};}
  if(!policy.allowed)return {state:'robots_denied',reason:'robots_disallows_target_path',robotsEvidence};
  return {state:'ready',delay:policy.delay,robotsEvidence};
}
export function publicSearchCache({engine,query,platform},cached=[]){
  const key=hash(JSON.stringify([engine,query,platform]));
  return cached.find(v=>v.key===key&&v.state==='read'&&Date.now()-Date.parse(v.retrievedAt)>=0&&Date.now()-Date.parse(v.retrievedAt)<86400000);
}
export async function searchPublicWeb(s,{engine,query,platform},cached=[]){
  const key=hash(JSON.stringify([engine,query,platform])),old=publicSearchCache({engine,query,platform},cached);
  if(old)return {...old,reused:true};
  if(!s.anonymous||!s.scope.engines?.includes(engine))throw Error('PUBLIC_SEARCH_SCOPE_REQUIRED');
  if(s.usage.searchQueries>=s.scope.maxSearchQueries||Date.now()>=s.expiresAt)return {state:'budget_exhausted',key,engine,query,results:[]};
  s.stage='search';s.engine=engine;s.platform=platform;s.usage.searchQueries++;
  const url=engine==='LangSearch'?'https://api.langsearch.com/v1/web-search':publicSearchUrl(engine,query),retrievedAt=new Date().toISOString(),base={key,engine,query,platform,url,retrievedAt,sourceType:'search_snippet',results:[],reused:false};
  if(engine==='LangSearch')return searchPublicIndex(s,base);
  const permission=await publicRobots(s,url);if(permission.state!=='ready')return {...base,...permission};
  if(permission.delay>5)return {...base,state:'rate_limited',reason:'crawl_delay_requires_later_batch'};
  try{
    if(s.usage.pageReads>=s.scope.maxPageReads||s.usage.networkRequests>=s.scope.maxNetworkRequests)return {...base,state:'budget_exhausted'};
    if(permission.delay)await s.page.waitForTimeout(permission.delay*1000);
    s.events.push({action:'public_search_submitted',query,url,engine,at:retrievedAt});
    const response=await s.page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});s.lastStatus=response?.status()||0;
    const text=await s.page.locator('body').innerText(),passwordVisible=await s.page.locator('input[type=password]').first().isVisible().catch(()=>false);
    const state=browserPageState({text,passwordVisible,status:s.lastStatus});if(state!=='ready')return {...base,state};
    if(new URL(s.page.url()).searchParams.get('q')!==query)return {...base,state:'restricted',reason:'search_redirected_from_query'};
    const links=await s.page.locator('a[href]').evaluateAll(anchors=>anchors.filter(a=>a.getClientRects().length).map(a=>({url:a.href,title:a.innerText,snippet:a.closest('li,article,.g')?.innerText||a.innerText})).slice(0,250));
    const seen=new Set(),results=[];for(const link of links){const target=searchTarget(link.url,engine);
      if(!target||!browserPlatformUrl(platform,target)||seen.has(target)||/help|developers|developer|support|policies/i.test(new URL(target).pathname))continue;
      seen.add(target);results.push({url:target,title:link.title.slice(0,500),snippet:link.snippet.slice(0,2500),sourceType:'search_snippet',query,engine,retrievedAt});}
    return {...base,state:'read',results,notice:results.length?'摘要仅为线索，尚未读取来源页':'本查询未找到相关链接，不代表平台没有资料'};
  }catch(e){return {...base,state:'read_failed',reason:String(e.message||e).split('\n')[0]};}
}
