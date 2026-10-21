import 'server-only';import {createHash,randomUUID} from 'node:crypto';
import {checkedAlternativeScope} from '@/domain/shortlist-alternative';
import {currentEntities} from '../../scripts/research/buyer-pipeline.mjs';
import {matchesEntityText} from '../../scripts/research/locator-plan.mjs';
import {firstPartyCandidate} from '@/domain/shortlist-website';
import {openBrowserSession,closeBrowserSession} from '../../scripts/research/browser-contact-session.mjs';
import {publicRobots,searchTarget} from '../../scripts/research/public-search-browser.mjs';
import {publicSearchUrl,browserPageState} from '../../scripts/research/browser-contact-policy.mjs';
export async function executeBrowserAlternative(row:any,save:any,config:any,deps:any={}){
 const d=row.data,s=checkedAlternativeScope(config.alternativeScope,row),engine=config.alternativeSource;
 if(!['Google','Bing'].includes(engine)||!config.beforeSend)throw Error('BROWSER_SOURCE_SCOPE_REQUIRED');
 const e=currentEntities(d).find((e:any)=>e.id===config.targetEntityId);if(!e)throw Error('CURRENT_TARGET_ENTITY_REQUIRED');
 const market=d.project.buyerGroup.searchSpecs?.[0]?.market||d.project.country,query=e.name+' '+market,url=publicSearchUrl(engine,query),key=createHash('sha256').update(JSON.stringify([engine,query])).digest('hex');
 d.shortlist ||= {revision:0,network:[],scopeIds:[]};d.shortlist.browserSources ||= [];
 const prior=d.shortlist.browserSources.find((r:any)=>r.key===key)||d.shortlist.browserSources.find((r:any)=>r.engine===engine&&['robots_denied','restricted','rate_limited','robots_unknown'].includes(r.state));
 let saving=Promise.resolve();const persist=(state:string,message:string)=>saving=saving.then(async()=>{row.data=d;await save(state,message);});
 if(prior){await persist('partial','浏览器入口已有结果，保留 '+prior.state+'，没有重复搜索');return;}
 const guard=async(i:any)=>{checkedAlternativeScope(s,row);return config.beforeSend(i);};
 await guard({service:'browser_search',requestKey:s.id+':browser:'+key,reservedCost:0});
 const record:any={key,engine,query,url,entityId:e.id,state:'pending',startedAt:new Date().toISOString(),submitted:false};d.shortlist.browserSources.push(record);await persist('running','正在检查匿名浏览器搜索入口');
 let session:any;const close=deps.close||closeBrowserSession;
 try{
  session=await (deps.open||openBrowserSession)({id:s.id,tenantId:s.tenantId,operatorId:row.actor_id,expiresAt:s.expiresAt,mode:'anonymous_public',engines:[engine],maxNetworkRequests:32,maxPageReads:1},'网页');
  session.stage='search';session.engine=engine;session.beforePublicRequest=async({url:address}:any)=>{
   await guard({service:'public_network',requestKey:s.id+':browser-network:'+randomUUID(),reservedCost:0});
   d.shortlist.network.push({url:new URL(address).origin+new URL(address).pathname,engine,scopeId:s.id,startedAt:new Date().toISOString(),status:'reserved'});await persist('running','浏览器请求与共享额度已保存');
  };
  const permission=await (deps.robots||publicRobots)(session,url);Object.assign(record,permission);
  if(permission.state!=='ready'||permission.delay>5){record.state=permission.state==='ready'?'rate_limited':permission.state;return;}
  await guard({service:'public_web',requestKey:s.id+':browser-page:'+key,reservedCost:0});
  record.submitted=true;const response=await session.page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});record.httpStatus=response?.status()||0;
  const text=await session.page.locator('body').innerText(),passwordVisible=await session.page.locator('input[type=password]').first().isVisible().catch(()=>false);
  record.state=browserPageState({text,passwordVisible,status:record.httpStatus});record.visibleText=text.slice(0,12000);
  if(record.state!=='ready'||new URL(session.page.url()).searchParams.get('q')!==query)return;
  const links=await session.page.locator('a[href]').evaluateAll((anchors:any[])=>anchors.filter(a=>a.getClientRects().length).map(a=>({url:a.href,title:a.innerText,snippet:a.closest('li,article,.g')?.innerText||a.innerText})).slice(0,250));
  record.results=links.flatMap((link:any)=>{const target=searchTarget(link.url,engine);return target&&matchesEntityText(e,link.title+' '+link.snippet)?[{url:target,title:link.title,snippet:link.snippet.slice(0,2500),sourceType:'search_snippet'}]:[];});
  const seen=new Set();record.results=record.results.filter((h:any)=>!seen.has(h.url)&&seen.add(h.url));
  const accepted=record.results.filter((h:any)=>firstPartyCandidate(e,h.url));
  if(accepted.length){e.siteCandidates=accepted;e.website=accepted[0].url;e.status='浏览器提供相关官网入口；正文与当地经营待核实';}
  record.state='read';
 }catch(error){record.state='failed';record.reason=(error as Error).message.split('\n')[0];}
 finally{
  record.finishedAt=new Date().toISOString();record.usage=session?.usage||null;
  if(session)await close(s.tenantId,row.actor_id).catch(()=>{});
  d.shortlist.message='浏览器入口：'+record.state+'；'+(record.submitted?'已保存搜索结果，摘要不是官网正文':'未提交搜索，规则／来源状态已保存');d.shortlist.next=null;d.shortlist.revision++;
  await persist('partial',d.shortlist.message);
 }
}
