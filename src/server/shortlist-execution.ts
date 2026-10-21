import 'server-only';
import {randomUUID} from 'node:crypto';
import type {Campaign} from '@/domain/research';
import {checkedShortlistScope} from '@/domain/shortlist-scope';
import {providerExclusions,relatedExclusions} from './analysis-search';
import {transport,ProviderError} from '../../scripts/research/http.mjs';
import {providers} from '../../scripts/research/providers.mjs';
import {discover} from '../../scripts/research/runner.mjs';
import {buyerPipeline,nextBuyerStage,currentEntities} from '../../scripts/research/buyer-pipeline.mjs';
import {locatorExclusions} from '../../scripts/research/locator-exclusions.mjs';
import {firstPartyCandidate} from '@/domain/shortlist-website';
import {cachedPublicPage,loadPublicPage} from '../../scripts/research/public-page.mjs';
import {pinnedGet} from '../../scripts/research/public-page-client.mjs';
import {coverageQueryOrder} from '../../scripts/research/discovery-policy.mjs';
import {knownShortlistEntries,seedShortlistEntries,unknownShortlistBlockers} from '@/domain/shortlist-assets';
import {pendingBuyerChecks} from '../../scripts/research/buyer-verification.mjs';
import {retainLocatorReferences} from '@/domain/shortlist-reference';
import {pointerSources} from '../../scripts/research/source-site-pointer.mjs';
import {checkedAlternativeScope} from '@/domain/shortlist-alternative';
import {executeApolloAlternative} from './shortlist-alternative-execution';
import {executeBrowserAlternative} from './shortlist-browser-source';
import {checkedRelatedPage} from '@/domain/shortlist-related-page';
import {checkedCandidatePage} from '@/domain/shortlist-candidate-page';
export function shortlistSourceIds(data:any){
  const pages=data.sourcePages||[],known=pages.filter((p:any)=>(data.companies||[]).some((c:any)=>!c.sourceOnly&&c.name&&String(p.title+' '+p.text).toLowerCase().includes(c.name.toLowerCase())));
  const current=pages.filter((p:any)=>p.provider!=='market_research'&&!p.reusedFromCampaigns?.length);
  return [...new Set<string>([...known,...current].map((p:any)=>p.id))].slice(0,20);
}
function locatorPlanFor(e:any){
  const done=new Set([...(e.resolutionHistory||[]),e.resolution].filter((r:any)=>r?.status==='done').map((r:any)=>r.plan));
  if(done.has('buyer-local-site-v1'))return null;
  return !done.has('buyer-exact-market-v1')?'buyer-exact-market-v1':!done.has('buyer-name-v2')?'buyer-name-v2':null;
}
export function shortlistNext(data:any){
  if(pendingBuyerChecks(data.project,currentEntities(data)).length)return 'verify-batch';
  if(coverageQueryOrder(data).length)return 'discover';
  if(!data.sourcePages?.length)return null;
  const next=nextBuyerStage(data,shortlistSourceIds(data));
  if(!next&&currentEntities(data).some((e:any)=>!e.website&&!e.resolutionAttempt&&locatorPlanFor(e)))return 'resolve';
  return next==='verify'?'verify-batch':next;
}
export function shortlistView(row:Campaign,config:any){
  const d=row.data;
  let available=false;try{config.alternativeScope?checkedAlternativeScope(config.alternativeScope,row):checkedShortlistScope(config.shortlistScope,row);available=!!config.live;}catch{}
  return {available,alternatives:!!config.alternativeScope,resumeOnly:!!config.alternativeScope?.continuation,accessChecks:d.shortlist?.accessChecks||[],knownEntries:knownShortlistEntries(d),stage:d.shortlist?.stage||null,next:d.shortlist&&Object.hasOwn(d.shortlist,'next')?d.shortlist.next:shortlistNext(structuredClone(d)),
    revision:d.shortlist?.revision||0,expiresAt:config.alternativeScope?.expiresAt||config.shortlistScope?.expiresAt||null,
    coverage:d.discoveryCoverage||null,message:d.shortlist?.message||'先按企业报告搜索，再核实官网与当地经营。',
    sources:d.sourcePages?.length||0,entities:d.sourcePipeline?.entities?.length||0,
    qualified:(d.companies||[]).filter((c:any)=>!c.sourceOnly&&c.qualification?.status==='qualified').length};
}
export async function executeShortlist(row:Campaign,save:(state:string,message:string)=>Promise<void>,config:any,fetcher:typeof fetch=fetch){
  const d=row.data;let scope;
  try{scope=config.alternativeScope?checkedAlternativeScope(config.alternativeScope,row):checkedShortlistScope(config.shortlistScope,row);}catch(e){await save('blocked',(e as Error).message+'；未发送请求。');return;}
  if(config.alternativeScope?.continuation&&!['health','apollo','read','verify'].includes(config.alternativeSource)){await save('blocked','该来源不在本轮续作范围内；未发送请求。');return;}
  if(config.alternativeScope&&['health','apollo'].includes(config.alternativeSource)){try{await executeApolloAlternative(row,save,config,fetcher);}catch(e){row.data=d;await save('blocked',(e as Error).message+'；未新增请求。');}return;}
  if(config.alternativeScope&&['Google','Bing'].includes(config.alternativeSource)){try{await executeBrowserAlternative(row,save,config);}catch(e){row.data=d;await save('blocked',(e as Error).message+'；未新增请求。');}return;}
  if(config.alternativeScope&&!['read','verify'].includes(config.alternativeSource)){await save('blocked','请选择已授权来源；未发送请求。');return;}
  if(!config.live||(!config.alternativeScope?.continuation&&!config.keys?.LANGSEARCH_API_KEY)||!config.keys?.DEEPSEEK_API_KEY||config.model!=='deepseek-flash'||!config.beforeSend){await save('blocked','当前批次接入或共享额度不可用；未发送请求。');return;}
  if(unknownShortlistBlockers(d,scope).length){await save('blocked','存在结果未知的旧请求，先核对；没有重发。');return;}
  seedShortlistEntries(d);
  retainLocatorReferences(d);
  if(config.targetEntityId&&!currentEntities(d).some((e:any)=>e.id===config.targetEntityId)){await save('blocked','所选企业不属于当前买家线索，未发送请求。');return;}
  d.shortlist ||= {revision:0,network:[],scopeIds:[]};
  if(!d.shortlist.scopeIds.includes(scope.id))d.shortlist.scopeIds.push(scope.id);
  const persist=async(state:string,message:string)=>{row.data=d;await save(state,message);};
  const checkpoint=async()=>persist('running','正在搜索、核实并保存企业初筛进度');
  const guard=async(item:{service:string;requestKey:string;reservedCost:number})=>{config.alternativeScope?checkedAlternativeScope(scope,row):checkedShortlistScope(scope,row);return config.beforeSend(item);};
  const raw=transport(d,{...config,beforeSend:guard,costUpperBound:{langsearch:0,ai:.05}},checkpoint,fetcher);
  const call=Object.assign(async(service:string,route:string,body:any,extra:any={})=>{
    if(service==='langsearch'&&route==='/v1/web-search'&&typeof body.query==='string'&&[10,50].includes(body.count)){const result=await raw(service,route,body,extra);const r=d.requests.findLast((r:any)=>r.service===service&&r.requestBody.query===body.query);if(r){r.purpose=stage==='resolve'?'official_resolution':'buyer_discovery';await checkpoint();}return result;}
    if(service==='ai'&&route==='/chat/completions'&&body.model==='deepseek-flash'&&body.max_tokens===8000&&Buffer.byteLength(JSON.stringify(body.messages),'utf8')<=45000)return raw(service,route,body,extra);
    throw new ProviderError('该接口不在企业初筛批次范围内','访问受限／未接入');
  },{commit:()=>raw.commit()});
  const readWebsite=async(url:string)=>{
    const cached=d.requests.find((r:any)=>r.service==='public_web'&&r.requestBody.url===url&&r.status==='done'&&Date.parse(r.expiresAt)>Date.now());
    if(!cached)await guard({service:'public_web',requestKey:scope.id+':page:'+randomUUID(),reservedCost:0});
    let pageNetworks=0;
    const get=async(address:string,options:any={})=>{
      let current=address;
      for(let i=0;i<6;i++){
        if(pageNetworks>=32)throw new ProviderError('当前公开页网络额度已到','访问受限／未接入');
        await guard({service:'public_network',requestKey:scope.id+':network:'+randomUUID(),reservedCost:0});pageNetworks++;
        const event:any={url:current,scopeId:scope.id,startedAt:new Date().toISOString(),status:'pending'};d.shortlist.network.push(event);await checkpoint();
        let result:any;
        try{result=await (config.publicGet||pinnedGet)(current,{...options,timeoutMs:20000});event.status='done';event.httpStatus=result.status;}
        catch(error){event.status='failed';event.error=String((error as Error).message);await checkpoint();throw error;}
        await checkpoint();
        if([301,302,303,307,308].includes(result.status)){if(!result.headers.location)throw new ProviderError('官网跳转缺少地址','待核实');current=new URL(result.headers.location,current).href;continue;}
        return {...result,networkRequests:i+1};
      }
      throw new ProviderError('官网跳转次数已到','待核实');
    };
    return cachedPublicPage(d,url,checkpoint,config,config.publicPageLoader||((address:string)=>loadPublicPage(address,get)));
  };
  const history=await config.entityExclusions?.(scope.campaignIds)||[];
  for(const e of d.sourcePipeline?.entities||[]){
    const queries=new Set([...(e.resolutionHistory||[]),e.resolution].map((r:any)=>r?.query).filter(Boolean));
    for(const r of d.requests)if(r.service==='langsearch'&&queries.has(r.requestBody.query))r.purpose='official_resolution';
    if(e.website&&!e.ownership?.verified&&!firstPartyCandidate(e,e.website)){(e.rejectedWebsiteCandidates ||= []).push({url:e.website,reason:'第三方提及，不作为官网扩读',observedAt:new Date().toISOString()});e.website='';e.status='第三方材料已保留，等待企业官网';}
  }
  const api=providers(call,{...config,searchProvider:'langsearch',searchResultCount:50,searchTextCharacters:1500,discoverySources:['网页搜索'],readWebsite,
    discoveryExclusions:(context:any={})=>context.entityId?locatorExclusions(d,d.sourcePipeline.entities.find((e:any)=>e.id===context.entityId),context.purpose||'official_resolution'):providerExclusions('langsearch',[...new Set([...history,...relatedExclusions('',[],d.companies)])])});
  Object.assign(api,{buyerRelatedLimit:0});
  const rawSearch=api.search;api.search=async(query:string,context:any={})=>{
    const hits=await rawSearch(query,context);if(!context.entityId)return hits;
    const e=d.sourcePipeline.entities.find((e:any)=>e.id===context.entityId),accepted=hits.filter((h:any)=>firstPartyCandidate(e,h.url));
    d.shortlist.rejectedLocatorHits ||= [];for(const h of hits.filter((h:any)=>!accepted.includes(h)))d.shortlist.rejectedLocatorHits.push({entityId:e.id,query,hit:h,reason:'网址未显示企业名称关联，保留为参考'});
    await checkpoint();return accepted;
  };
  const target=currentEntities(d).find((e:any)=>e.id===config.targetEntityId);
  const readableReference=target&&pointerSources(d,target).some((p:any)=>!target.referencePages?.some((r:any)=>r.url===p.url));
  const stage=config.alternativeScope?(config.alternativeSource==='verify'?'verify-batch':target?.website||readableReference?'read-sites':null):target?(target.website||readableReference?'read-sites':'resolve'):shortlistNext(d);d.shortlist.stage=stage;
  try{
    if(config.alternativeScope&&config.alternativeSource==='read'&&config.targetPageUrl){
      if(!target)throw Error('CURRENT_TARGET_ENTITY_REQUIRED');
      const candidate=target.resolution?.hits?.some((h:any)=>h.url===config.targetPageUrl);
      if(candidate){
        target.website=checkedCandidatePage(target,config.targetPageUrl);
        await buyerPipeline(d,'read-sites',api,checkpoint,target.id,undefined,undefined,false,shortlistSourceIds(d));
      }else{
      const url=checkedRelatedPage(target,config.targetPageUrl);
      if(!target.websitePages?.some((p:any)=>p.url===url&&(p.content||p.readFailure))){
        const page=await api.read(url,'网页');
        target.websitePages ||= [];target.websitePages.push({...page,retrievedAt:new Date().toISOString()});
        target.unreadRelatedLinks=(target.unreadRelatedLinks||[]).filter((u:string)=>u!==url);await checkpoint();
      }
      }
    }else if(stage==='discover')await discover(d,api,checkpoint);
    else if(stage){const e=target||currentEntities(d).find((e:any)=>!e.website&&!e.resolutionAttempt&&locatorPlanFor(e));
      await buyerPipeline(d,stage,api,checkpoint,target?.id||(stage==='resolve'?e?.id:undefined),stage==='resolve'&&e?locatorPlanFor(e):undefined,undefined,false,shortlistSourceIds(d));}
    call.commit();d.shortlist.next=target||stage==='verify-batch'?null:shortlistNext(d);d.shortlist.revision++;d.shortlist.updatedAt=new Date().toISOString();
    const message=d.shortlist.next?'本阶段已保存，继续处理搜索与官网核实。':d.companies.some((c:any)=>!c.sourceOnly&&c.qualification?.status==='qualified')?'本轮已保存企业初筛名单；未知及受限项保留，请选择值得深入研究的企业。':'已保存企业线索，尚无完成适配核实的企业；请查看缺项和来源受限原因。';
    d.shortlist.message=message;await persist('partial',message);
  }catch(e){d.shortlist.revision++;d.shortlist.message=(e as Error).message;d.shortlist.next=null;await persist('blocked',(e as Error).message+'；资料和剩余覆盖范围已保存。');}
}
