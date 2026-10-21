import 'server-only';
import type {Campaign} from '@/domain/research';
import {platformNames} from '@/domain/research';
import {transport,ProviderError} from '../../scripts/research/http.mjs';
import {providers} from '../../scripts/research/providers.mjs';
import {discover,research} from '../../scripts/research/runner.mjs';
import {analyze,needsAnalysis} from '../../scripts/research/analysis.mjs';
import {reconcileMainland} from '../../scripts/research/mainland-profile.mjs';
import {needsWork,latest} from '../../scripts/research/state.mjs';
import {discoverApollo} from '../../scripts/research/apollo-discovery.mjs';
import {apolloLocation} from '../../scripts/research/apollo.mjs';
import {providerExclusions,relatedExclusions} from './analysis-search';
import {mainlandMarket,webProviderFor} from '../../scripts/research/search-capabilities.mjs';
import {apolloPurposeAllowed} from './source-permissions';
import {qualityMetrics} from '../../scripts/research/quality-metrics.mjs';
import {platformsFor} from '../../scripts/research/schema.mjs';
import {cachedPublicPage} from '../../scripts/research/public-page.mjs';
import {executeBuyerStage} from './buyer-pipeline-service';
import {buyerStages,nextBuyerStage,currentEntities} from '../../scripts/research/buyer-pipeline.mjs';
import {pipelineMetrics,savedSources} from '../../scripts/research/discovery-sources.mjs';
import {resolutionQueries} from '../../scripts/research/discovery-entities.mjs';
import {locatorPlans,locatorComparison} from '../../scripts/research/locator-plan.mjs';
import {locatorExclusions,locatorInclusions} from '../../scripts/research/locator-exclusions.mjs';
import {executeShortlist,shortlistView} from './shortlist-execution';
const sameBody=(a:any,b:any)=>{
  const ordered=(_key:string,v:any)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v;
  return JSON.stringify(a,ordered)===JSON.stringify(b,ordered);
};
export function providerConfig(env:Record<string,string|undefined>=process.env){
  let alternativeScope:any;try{alternativeScope=env.RESEARCH_SHORTLIST_ALTERNATIVE_SCOPE?JSON.parse(env.RESEARCH_SHORTLIST_ALTERNATIVE_SCOPE):undefined;}catch{alternativeScope=false;}
  let shortlistScope:any;try{shortlistScope=env.RESEARCH_SHORTLIST_SCOPE?JSON.parse(env.RESEARCH_SHORTLIST_SCOPE):undefined;}catch{shortlistScope=false;}
  let entityScope:any;try{entityScope=env.RESEARCH_ENTITY_SCOPE?JSON.parse(env.RESEARCH_ENTITY_SCOPE):undefined;}catch{entityScope=false;}
  if(env.RESEARCH_ENTITY_SCOPE&&(!entityScope||typeof entityScope!=='object'||Array.isArray(entityScope)))entityScope=false;
  let trialScope:any;try{trialScope=env.RESEARCH_TRIAL_SCOPE?JSON.parse(env.RESEARCH_TRIAL_SCOPE):undefined;}catch{trialScope=false;}
  if(env.RESEARCH_TRIAL_SCOPE&&(!trialScope||typeof trialScope!=='object'||Array.isArray(trialScope)))trialScope=false;
  const keys:Record<string,string|undefined>=entityScope!==undefined?{LANGSEARCH_API_KEY:env.LANGSEARCH_API_KEY,DEEPSEEK_API_KEY:env.DEEPSEEK_API_KEY}:trialScope!==undefined?{LANGSEARCH_API_KEY:env.LANGSEARCH_API_KEY}:env;
  if(entityScope&&entityScope.maxApolloCreditsPerCampaign>0)keys.APOLLO_API_KEY=env.APOLLO_API_KEY;
  let costs:any={};try{costs=JSON.parse(env.RESEARCH_COST_UPPER_BOUND||'{}');}catch{}
  costs.apollo??=0;
  const searchProvider=webProviderFor('Sweden',keys);
  return {live:env.RESEARCH_LIVE_ENABLED==='true',publicWeb:env.RESEARCH_PUBLIC_WEB_ENABLED==='true',keys,costUpperBound:costs,model:env.RESEARCH_MODEL,searchProvider,trialScope,entityScope,shortlistScope,alternativeScope,
    searchResultCount:trialScope?.count,searchTextCharacters:trialScope?.maxCharacters,
    apolloTrialTenant:env.RESEARCH_APOLLO_TENANT_ID,apolloCreditLimit:Number(env.RESEARCH_APOLLO_CREDIT_LIMIT||0),
    apolloPurpose:'internal_test',sourceGrants:[],
    discoverySources:env.RESEARCH_DISCOVERY_SOURCES==='web'?['网页搜索']:undefined,
    mapsDataRights:env.GOOGLE_MAPS_DATA_RIGHTS==='confirmed',socialReadAllowed:(env.RESEARCH_SOCIAL_READ_ALLOWED||'').split(',').filter(Boolean),
    cacheSeconds:{bocha:86400,langsearch:86400,search:86400,scrape:86400,apollo:86400,ai:86400,maps:0}};
}
export function connectionStatus(config=providerConfig()){
  return [{name:'博查大陆搜索',key:'BOCHA_API_KEY'},{name:'LangSearch海外搜索',key:'LANGSEARCH_API_KEY'},{name:'Google Maps',key:'GOOGLE_MAPS_API_KEY'},{name:'网页研究',key:'FIRECRAWL_API_KEY'},{name:'Apollo',key:'APOLLO_API_KEY'},{name:'AI 分析',key:'DEEPSEEK_API_KEY'}].map(x=>({name:x.name,configured:Boolean(config.keys[x.key])||(x.name==='网页研究'&&!!config.publicWeb)}));
}
export function preflight(data:any,stage:string,config=providerConfig()){
  const missing:string[]=[];
  if(stage==='discover'&&(!data.project.buyerGroup?.ready||!data.project.buyerGroup?.analysisId)){
    missing.push('请先让 AI 了解企业，再从已检查的客户方向建立搜索；历史结果仍可查看');
  }
  const apollo=stage==='discover'&&data.project.discoveryProvider==='apollo';
  const source=data.project.webProvider||config.searchProvider;
  if(stage==='discover'&&data.project.buyerGroup){
    if(!data.project.buyerGroup.searchSpecs?.length)missing.push('请从当前企业分析重新生成结构化搜索计划');
    if(apollo&&data.project.buyerGroup.searchSpecs?.some((s:any)=>s.marketMode!=='headquarters'))missing.push('Apollo 仅按总部地区筛选，请使用网页搜索核实当地经营范围');
    try{providerExclusions(apollo?'apollo':source,data.project.excludedDomains||[]);}catch(e){missing.push((e as Error).message);}
  }
  if(stage==='discover'&&data.project.buyerGroup){
    if(!apollo&&source==='bocha'&&!mainlandMarket(data.project.country))missing.push('海外网页搜索接入；当前博查入口用于大陆，可选择 Apollo');
    if(data.batches.some((b:any)=>b.error?.includes('EXCLUSION_VIOLATION')))missing.push('已提交排除域名仍被返回，需核对来源');
  }
  if(apollo){
    if(!apolloPurposeAllowed(data.project.tenantId,config.apolloTrialTenant,config.apolloPurpose||'internal_test',config.sourceGrants||[])){
      missing.push('Apollo 当前用途的数据授权；密钥存在不能证明商业 SaaS 数据许可');
    }
    if(!config.keys.APOLLO_API_KEY)missing.push('Apollo 密钥');
    if(!config.apolloTrialTenant||data.project.tenantId!==config.apolloTrialTenant)missing.push('本企业的 Apollo 试测授权');
    if(!(config.apolloCreditLimit>0&&config.apolloCreditLimit<=5))missing.push('Apollo 试测总积分上限');
    try{apolloLocation(data.project.country,data.project.city);}catch(e){missing.push((e as Error).message);}
  }
  if(stage==='discover'&&!apollo){
    const key=source==='bocha'?'BOCHA_API_KEY':source==='langsearch'?'LANGSEARCH_API_KEY':'TAVILY_API_KEY';
    if(!config.keys[key])missing.push('当前选择的网页搜索来源接入');
  }
  if(stage==='research'&&!config.keys.FIRECRAWL_API_KEY&&!config.publicWeb)missing.push('网页研究接入');
  if(stage==='analyze'&&(!config.keys.DEEPSEEK_API_KEY||!config.model))missing.push('AI 接入与模型配置');
  if(!config.live&&!(stage==='research'&&config.publicWeb))missing.push('管理员启用真实采集');
  if(!(data.project.maxRequests>0))missing.push('本批请求额度');
  if(!(data.project.maxSpendUsd>=0))missing.push('本批费用上限');
  const service=apollo?'apollo':stage==='discover'?(source==='tavily'?'search':source):stage==='research'?'scrape':'ai';
  if(!(stage==='research'&&config.publicWeb)&&(!Number.isFinite(config.costUpperBound[service])||config.costUpperBound[service]<0))missing.push('服务单次费用上界');
  return missing;
}
export function present(row:Campaign,milestone?:any){
  const d=row.data;
  const config=providerConfig(),scope=config.entityScope;
  const execution={expiresAt:scope?.expiresAt||null,allowedPlans:scope?.allowedLocatorPlans||[],
    available:Boolean(config.live&&scope?.tenantId===row.tenant_id&&scope?.campaignIds?.includes(row.id)&&(!scope.activeCampaignIds||scope.activeCampaignIds.includes(row.id))&&Date.now()+60000<Date.parse(scope.expiresAt)&&!d.requests.some((r:any)=>['pending','unknown'].includes(r.status)))};
  return {id:row.id,state:row.state,message:row.message,version:row.version,project:d.project,milestone,shortlist:shortlistView(row,config),
    sourcePipeline:{...pipelineMetrics(d),execution,active:Boolean(d.sourcePipeline),nextStage:nextBuyerStage(d),sources:savedSources(d).map((p:any)=>({id:p.id,url:p.url,title:p.title,kind:p.kind,status:p.status})),entities:(d.sourcePipeline?.entities||[]).map((e:any)=>({...e,previewQuery:resolutionQueries(e,d.project)[0],conciseQuery:resolutionQueries(e,d.project,true)[1],locatorPlans:locatorPlans(e,d.project).map(p=>({...p,excludeDomains:locatorExclusions(d,e,p.purpose),includeDomains:locatorInclusions(e,p.purpose)})),locatorComparison:locatorComparison(e)}))},
    quality:qualityMetrics(d),
    counts:{found:d.companies.filter((c:any)=>!c.sourceOnly).length,researched:d.companies.filter((c:any)=>!c.sourceOnly&&platformsFor(d.project).every(p=>latest(d,c.id,p)?.status?.startsWith('已完成'))).length,
      contacts:d.contacts.length,requests:d.requests.length,reservedCredits:d.requests.reduce((s:number,r:any)=>s+(r.reservedCredits||0),0),reservedUsd:d.requests.reduce((s:number,r:any)=>s+r.reservedCost,0)},
    batches:d.batches.map((b:any)=>({query:b.query,provider:b.provider,source:b.source,count:b.count,added:b.added,duplicates:b.duplicates,excluded:b.excluded?.length||0,status:b.status,error:b.error})),
    companies:d.companies.filter((c:any)=>!c.sourceOnly).map((c:any)=>({id:c.id,name:c.name,country:c.country,city:c.city,profile:c.profile||null,website:c.website,source:c.source,status:c.status,discovery:c.discovery||[],
      apolloId:c.apolloId,industry:c.industry,employees:c.employees,fitStatus:c.fitStatus,fitReason:c.fitReason,qualification:c.qualification,score:c.score,targetMarket:c.targetMarket||d.project.country,
      analysis:c.analysis?{fit:c.analysis.fit,pain:c.analysis.pain,draft:d.project.buyerGroup&&needsAnalysis(d,c)?'':c.analysis.draft}:null,
      outreach:d.project.buyerGroup&&needsAnalysis(d,c)?null:c.outreach,
      outreachStatus:d.project.buyerGroup&&c.outreach&&needsAnalysis(d,c)?'资料已变更，草稿待重新生成':c.outreachStatus,
      outreachError:c.outreachError,analysisStatus:c.analysisStatus,apolloStatus:c.apolloStatus,
      contacts:d.contacts.filter((p:any)=>p.companyId===c.id&&!p.suppressed).map((p:any)=>({name:p.name,title:p.title,email:p.email,emailStatus:p.emailStatus,phone:p.phone,source:p.source})),
      platforms:platformsFor(d.project).map(platform=>{const a=latest(d,c.id,platform);return {platform,status:a?.status||'未开始',url:a?.url,summary:a?.summary,error:a?.error,readScope:a?.readScope};})}))};
}
export async function executeSearch(row:Campaign,stage:'discover'|'research'|'analyze'|'prepare'|'extract'|'resolve'|'verify'|'read-sites'|'verify-batch'|'review-saved'|'buyers'|'shortlist',save:(state:string,message:string)=>Promise<void>,config:any=providerConfig(),fetcher:typeof fetch=fetch){
  if(stage==='shortlist'){await executeShortlist(row,save,config,fetcher);return;}
  if(config.shortlistScope!==undefined){await save('blocked','本轮为企业初筛批次，请使用“搜索并初筛企业”；未启动其他研究或邮件。');return;}
  if(config.targetEntityId&&(!['resolve','read-sites','verify-batch','review-saved'].includes(stage)||!currentEntities(row.data).some((e:any)=>e.id===config.targetEntityId))){
    await save('blocked','选择的企业不属于本任务当前客户方向。未发出请求。');return;
  }
  if(config.entityScope!==undefined&&stage!=='buyers'&&!buyerStages.includes(stage)){
    await save('blocked','本轮仅允许来源到买家流程；其他搜索、社媒、邮件与模型步骤尚未授权。');return;
  }
  if(stage==='buyers'){await executeBuyerStage(row,'prepare',save,config,fetcher);const next=nextBuyerStage(row.data);if(!next){await save('partial','现有买家线索已处理；请核对有效数、待核实项和查询建议。');return;}await executeBuyerStage(row,next,save,config,fetcher);return;}
  if(buyerStages.includes(stage)){await executeBuyerStage(row,stage,save,config,fetcher);return;}
  config={...config,searchProvider:row.data.project.webProvider||webProviderFor(row.data.project.country,config.keys)};
  const trial=config.trialScope;
  if(trial!==undefined&&(trial===false||Date.now()+60000>=Date.parse(trial.expiresAt)||trial.tenantId!==row.tenant_id||
    !trial.campaignIds?.includes(row.id)||!['discover','research'].includes(stage)||trial.count!==10||trial.maxCharacters!==1500||
    row.data.project.analysis?.id!==trial.analysisId||row.data.project.webProvider!=='langsearch'||
    row.data.project.maxRequests>14||row.data.project.maxSpendUsd!==0)){
    await save('blocked','本任务、接口或时间不在本轮免费试跑范围。');return;
  }
  const data=row.data,apollo=stage==='discover'&&data.project.discoveryProvider==='apollo';if(stage==='discover'&&!apollo&&!data.project.buyerGroup)reconcileMainland(data);
  const missing=preflight(data,stage,config);
  if(missing.length){await save('blocked','需要配置：'+missing.join('、')+'。任务已保存，尚未调用外部平台。');return;}
  if(data.requests.some((r:any)=>['pending','unknown'].includes(r.status))){await save('blocked','存在结果未知的外部请求，需核对供应商记录后恢复。');return;}
  if(apollo&&data.requests.some((r:any)=>r.service==='apollo'&&[401,403].includes(r.httpStatus))){await save('blocked','Apollo 未允许当前密钥或套餐访问企业搜索，已保留请求记录；请先处理接口权限。');return;}
  let calls=0,yielded=false;
  const checkpoint=async()=>{row.data=data;await save('running','正在处理并保存进度');};
  const raw=transport(data,config,checkpoint,fetcher);
  const limited=Object.assign(async(service:string,route:string,body:any,extra:any={})=>{
    if(trial){
      const cached=data.requests.some((r:any)=>r.service===service&&r.route===route&&sameBody(r.requestBody,body)&&r.status==='done'&&Date.parse(r.expiresAt)>Date.now());
      if(service!=='langsearch'||route!=='/v1/web-search'||body.count!==10||body.contents?.text?.maxCharacters!==1500||
        !data.project.buyerGroup.searchSpecs.some((s:any)=>s.query===body.query)||
        (!cached&&data.requests.filter((r:any)=>r.service==='langsearch').length>=4))throw new ProviderError('本轮搜索次数或接口范围已到，结果已保存。','访问受限／未接入');
    }
    if(service==='apollo'&&!apolloPurposeAllowed(data.project.tenantId,config.apolloTrialTenant,config.apolloPurpose||'internal_test',config.sourceGrants||[])){
      throw new ProviderError('当前企业尚无 Apollo 联系人用途授权','访问受限／未接入');
    }
    if(calls>=4){yielded=true;throw new ProviderError('本轮处理完成，请继续执行','待重试');}
    calls++;return raw(service,route,body,extra);
  },{commit:()=>raw.commit()});
  const exclusions=()=>providerExclusions(data.project.webProvider||config.searchProvider,[...new Set<string>([...(data.project.excludedDomains||[]),...relatedExclusions('',[],data.companies)])]);
  const readWebsite=config.publicWeb?async(url:string)=>{
    if(trial&&data.requests.filter((r:any)=>r.service==='public_web').length>=10)throw new ProviderError('本轮官网核实次数已到。','访问受限／未接入');
    if(calls>=4){yielded=true;throw new ProviderError('本轮处理完成，请继续执行','待重试');}
    calls++;return cachedPublicPage(data,url,checkpoint,config,(config as {publicPageLoader?:typeof import('../../scripts/research/public-page.mjs').loadPublicPage}).publicPageLoader);
  }:undefined;
  const researchConfig={...config,buyerGroup:data.project.buyerGroup,readWebsite};
  const api=providers(limited,stage==='discover'&&data.project.buyerGroup?{...researchConfig,discoverySources:['网页搜索'],discoveryExclusions:exclusions}:researchConfig);
  try{
    if(apollo){
      await discoverApollo(data,limited,checkpoint);
      const reached=qualityMetrics(data).qualified>=data.project.target;
      await save(reached?'complete':'partial',reached?'已达到有效企业目标，采购意愿仍需后续沟通。':'本轮已保存。请核实候选的官网、市场和合作关系；当前返回不代表有效买家。');return;
    }
    if(stage==='discover')await discover(data,api,checkpoint);
    else {
      const checkedPlatforms=trial?['网页']:platformNames;
      const c=data.companies.find((c:any)=>c.status!=='已排除'&&(stage==='research'?checkedPlatforms.some(p=>needsWork(latest(data,c.id,p))):needsAnalysis(data,c)));
      if(!c){await save('partial','本阶段没有可立即执行的客户；请查看待核实、受限或等待重试的记录。');return;}
      const view={...data,companies:[c]};
      if(stage==='research')await research(view,api,checkpoint,trial?{contacts:false,platforms:['网页']}:undefined);else await analyze(view,api,checkpoint);
    }
    row.data=data;
    const errors=stage==='discover'?data.batches.filter((b:any)=>!['已完成','待续—仍有分页'].includes(b.status)):data.attempts.filter((a:any)=>a.current&&!a.status.startsWith('已完成'));
    const reached=qualityMetrics(data).qualified>=data.project.target;
    await save(reached?'complete':'partial',reached?'已达到有效企业目标，采购意愿仍需后续沟通。':yielded?'本轮进度已保存，可继续处理下一批。':errors.length?'存在未完成项目，请查看来源接入或平台状态。':'本轮已保存，请核实候选资料；有效企业目标尚未完成。');
  }catch(e){row.data=data;await save('blocked',e instanceof ProviderError?e.message:(e as Error).message==='APOLLO_CREDIT_LIMIT'?'本账户 Apollo 试测总积分上限已到，未发出新的请求。':'执行中断，进度已保留，请核对后恢复。');}
}
