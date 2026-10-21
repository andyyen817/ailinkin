import 'server-only';
import type {Campaign} from '@/domain/research';
import {buyerPipeline} from '../../scripts/research/buyer-pipeline.mjs';
import {providers} from '../../scripts/research/providers.mjs';
import {transport,ProviderError} from '../../scripts/research/http.mjs';
import {cachedPublicPage,loadPublicPage} from '../../scripts/research/public-page.mjs';
import {renderEmptyPublicPage} from '../../scripts/research/public-render.mjs';
import {referenceDomains,resolutionQueries} from '../../scripts/research/discovery-entities.mjs';
import {relatedExclusions,providerExclusions} from './analysis-search';
import {targetMilestone} from '../../scripts/research/target-milestone.mjs';
import {locatorPlanIds,locatorPlans,selectLocatorPlan} from '../../scripts/research/locator-plan.mjs';
import {locatorExclusions,locatorInclusions} from '../../scripts/research/locator-exclusions.mjs';
import {locateOrganizations,apolloLocatorBody} from '../../scripts/research/apollo-locator.mjs';
import {apolloPurposeAllowed} from './source-permissions';
import {observedMarketLinks} from '../../scripts/research/buyer-site-pages.mjs';
import {recheckSavedBuyers} from '../../scripts/research/saved-buyer-review.mjs';
export async function executeBuyerStage(row:Campaign,stage:string,save:(state:string,message:string)=>Promise<void>,config:any,fetcher:typeof fetch=fetch){
  const data=row.data,checkpoint=async()=>{
    const scope=config.entityScope;
    if(scope?.kind==='source-to-buyer'){
      const fresh=data.requests.filter((r:any)=>!scope.baselineRequestIds?.includes(r.id));
      if(data.sourcePipeline)data.sourcePipeline.budget={ai:Math.max(0,scope.maxAiRequestsPerCampaign-fresh.filter((r:any)=>r.service==='ai').length),search:Math.max(0,scope.maxSearchRequestsPerCampaign-fresh.filter((r:any)=>r.service==='langsearch').length),web:Math.max(0,scope.maxPublicPagesPerCampaign-fresh.filter((r:any)=>r.service==='public_web').length),apolloCredits:Math.max(0,(scope.maxApolloCreditsPerCampaign||0)-fresh.filter((r:any)=>r.service==='apollo').reduce((n:number,r:any)=>n+(r.reservedCredits||0),0))};
    }
    row.data=data;await save('running','正在保存来源识别与买家核实进度');
  };
  if(!data.project.buyerGroup?.ready){await save('blocked','请先完成企业分析并选择客户方向。');return;}
  if(stage==='prepare'){const message=await buyerPipeline(data,stage,{},checkpoint);await save('partial',message);return;}
  const scope=config.entityScope;
  const bounded=(n:number,max:number)=>Number.isInteger(n)&&n>=0&&n<=max;
  if(!scope||scope.kind!=='source-to-buyer'||scope.tenantId!==row.tenant_id||!Array.isArray(scope.campaignIds)||
    scope.campaignIds.length!==2||new Set(scope.campaignIds).size!==2||!scope.campaignIds.includes(row.id)||
    (scope.activeCampaignIds!==undefined&&(!Array.isArray(scope.activeCampaignIds)||!scope.activeCampaignIds.length||scope.activeCampaignIds.some((id:string)=>!scope.campaignIds.includes(id))||!scope.activeCampaignIds.includes(row.id)))||
    scope.analysisId!==data.project.analysis?.id||!Number.isFinite(Date.parse(scope.expiresAt))||Date.now()+60000>=Date.parse(scope.expiresAt)||
    !bounded(scope.maxAiRequestsPerCampaign,4)||!bounded(scope.maxSearchRequestsPerCampaign,4)||!bounded(scope.maxPublicPagesPerCampaign,11)||(scope.maxPublicPagesPerCampaign===11&&!scope.additionalPublicPageUrl)||
    (scope.maxApolloCreditsPerCampaign!==undefined&&!bounded(scope.maxApolloCreditsPerCampaign,3))||
    !Number.isFinite(scope.maxSpendUsdPerCampaign)||scope.maxSpendUsdPerCampaign<0||scope.maxSpendUsdPerCampaign>.25||!Array.isArray(scope.baselineRequestIds)||
    (scope.allowedStages!==undefined&&(!Array.isArray(scope.allowedStages)||!scope.allowedStages.includes(stage)))){
    await save('blocked','本轮真实识别与官网核实额度尚未批准或已过期；来源资料已保留。');return;
  }
  const fresh=()=>data.requests.filter((r:any)=>!scope.baselineRequestIds.includes(r.id));
  if(config.targetPageUrl){
    const e=data.sourcePipeline?.entities.find((e:any)=>e.id===config.targetEntityId);
    if(stage!=='read-sites'||!e||scope.additionalPublicPageUrl!==config.targetPageUrl||!observedMarketLinks(e).includes(config.targetPageUrl)){
      await save('blocked','该门店页面未在官网观察到或尚未批准。');return;
    }
  }
  if(config.renderEmptyHtml&&(stage!=='read-sites'||!config.targetEntityId)){
    await save('blocked','动态读取必须选择已保存的具体官网候选。');return;
  }
  if(scope.allowedEntityIds&&(!Array.isArray(scope.allowedEntityIds)||(config.targetEntityId&&!scope.allowedEntityIds.includes(config.targetEntityId)))){
    await save('blocked','该企业不属于本轮已批准的研究名单。');return;
  }
  const resolutionPlan=config.resolutionPlan||(stage==='resolve'&&scope.allowedLocatorPlans?.includes('buyer-name-v2')?'buyer-name-v2':undefined);
  const newPlan=locatorPlanIds.includes(resolutionPlan);
  if(config.resolutionPlan&&(stage!=='resolve'||(!newPlan&&(!config.targetEntityId||config.resolutionPlan!=='concise-v1')))){
    await save('blocked','官网查询方案不属于当前选择阶段。');return;
  }
  if(newPlan&&(!Array.isArray(scope.allowedLocatorPlans)||!scope.allowedLocatorPlans.includes(resolutionPlan))){
    await save('blocked','本轮尚未批准该官网查询方式，查询预览及历史已保留。');return;
  }
  const apollo=resolutionPlan==='apollo-name-v1';
  if(apollo&&(!bounded(scope.maxApolloCreditsPerCampaign,3)||!scope.maxApolloCreditsPerCampaign||
    !apolloPurposeAllowed(row.tenant_id,config.apolloTrialTenant,config.apolloPurpose||'internal_test',config.sourceGrants||[])||!config.keys.APOLLO_API_KEY)){
    await save('blocked','Apollo 组织定位尚无本轮积分或用途授权，未发出请求。');return;
  }
  if(stage!=='review-saved'&&config.milestoneRows&&targetMilestone(await config.milestoneRows(scope.campaignIds)).reached){
    await save('partial','三家目标客户里程碑已达到，停止新增采集，请逐家复核证据。');return;
  }
  if(data.requests.some((r:any)=>['pending','unknown'].includes(r.status))){await save('blocked','存在结果未知的请求，不能重新调用。');return;}
  if(stage==='review-saved'){
    const entities=(data.sourcePipeline?.entities||[]).filter((e:any)=>e.role==='potential_buyer'&&!e.locatorOnly&&(!config.targetEntityId||e.id===config.targetEntityId)&&(!scope.allowedEntityIds||scope.allowedEntityIds.includes(e.id)));
    const message=await recheckSavedBuyers(data,entities,checkpoint);await save('partial',message);return;
  }
  const model=['extract','verify','verify-batch'].includes(stage);
  if(['verify','verify-batch','read-sites'].includes(stage)&&fresh().filter((r:any)=>r.service==='ai').length>=scope.maxAiRequestsPerCampaign){
    await save('blocked','本轮DeepSeek次数已到，已保存官网候选；未新增官网读取。');return;
  }
  if(!config.live||(model&&!(config.keys.DEEPSEEK_API_KEY&&config.model==='deepseek-flash'))||(stage==='resolve'&&!apollo&&!config.keys.LANGSEARCH_API_KEY)||
    (model&&!Number.isFinite(config.costUpperBound.ai))||(['verify','read-sites'].includes(stage)&&!config.publicWeb)){
    await save('blocked','需要已授权的DeepSeek／LangSearch及官网读取接入，未发出新请求。');return;
  }
  data.project.maxRequests=scope.baselineRequestIds.filter((id:string)=>data.requests.some((r:any)=>r.id===id)).length+scope.maxAiRequestsPerCampaign+scope.maxSearchRequestsPerCampaign+scope.maxPublicPagesPerCampaign+(scope.maxApolloCreditsPerCampaign||0);
  if(apollo)data.project.maxApolloCredits=data.requests.filter((r:any)=>scope.baselineRequestIds.includes(r.id)).reduce((n:number,r:any)=>n+(r.reservedCredits||0),0)+scope.maxApolloCreditsPerCampaign;
  data.project.maxSpendUsd=data.requests.filter((r:any)=>scope.baselineRequestIds.includes(r.id)).reduce((n:number,r:any)=>n+(r.reservedCost||0),0)+scope.maxSpendUsdPerCampaign;await checkpoint();
  const history=await config.entityExclusions?.(scope.campaignIds)||[];
  const raw=transport(data,config,checkpoint,fetcher);
  const allowed=Object.assign(async(service:string,route:string,body:any,extra:any={})=>{
    const cached=data.requests.some((r:any)=>r.status==='done'&&r.service===service&&r.route===route&&JSON.stringify(r.requestBody)===JSON.stringify(body)&&Date.parse(r.expiresAt)>Date.now());
    if(service==='ai'){
      if(route!=='/chat/completions'||body.model!==config.model||body.max_tokens!==8000||Buffer.byteLength(JSON.stringify(body.messages),'utf8')>45000)throw new ProviderError('模型请求超出已批准载荷范围','访问受限／未接入');
      if(!cached&&fresh().filter((r:any)=>r.service==='ai').length>=scope.maxAiRequestsPerCampaign)throw new ProviderError('本轮DeepSeek次数已到，结果保留','访问受限／未接入');
    }else if(service==='langsearch'){
      const queries=(data.sourcePipeline?.entities||[]).filter((e:any)=>!config.targetEntityId||e.id===config.targetEntityId).flatMap((e:any)=>newPlan?locatorPlans(e,data.project).filter(p=>p.provider==='langsearch'&&p.id===resolutionPlan).map(p=>p.query):resolutionQueries(e,data.project,true));
      if(route!=='/v1/web-search'||!queries.includes(body.query)||body.count!==10||body.contents?.text?.maxCharacters!==1500)throw new ProviderError('官网定位查询超出范围','访问受限／未接入');
      if(newPlan&&!scope.approvedSearchBodies?.some((b:any)=>JSON.stringify(b)===JSON.stringify(body)))throw new ProviderError('当前查询与域名参数尚未批准，未发送','访问受限／未接入');
      if(!cached&&fresh().filter((r:any)=>r.service==='langsearch').length>=scope.maxSearchRequestsPerCampaign)throw new ProviderError('本轮官网定位搜索次数已到','访问受限／未接入');
    }else if(service==='apollo'&&apollo){
      const names=(data.sourcePipeline?.entities||[]).filter((e:any)=>!config.targetEntityId||e.id===config.targetEntityId).map((e:any)=>e.name);
      if(route!=='/api/v1/mixed_companies/search'||!names.includes(body.q_organization_name)||JSON.stringify(body)!==JSON.stringify(apolloLocatorBody(body.q_organization_name))||!scope.approvedApolloNames?.includes(body.q_organization_name))throw new ProviderError('Apollo 名称查询超出批准范围','访问受限／未接入');
      if(!cached&&fresh().filter((r:any)=>r.service==='apollo').reduce((n:number,r:any)=>n+(r.reservedCredits||0),0)>=scope.maxApolloCreditsPerCampaign)throw new ProviderError('本轮 Apollo 积分已到','访问受限／未接入');
    }else throw new ProviderError('本轮未授权该接口','访问受限／未接入');
    const response=await raw(service,route,body,extra);
    if(service==='langsearch'){
      const request=data.requests.filter((r:any)=>r.service===service&&JSON.stringify(r.requestBody)===JSON.stringify(body)).at(-1);
      if(request)request.purpose=newPlan?locatorPlans((data.sourcePipeline.entities||[]).find((e:any)=>locatorPlans(e,data.project).some(p=>p.query===body.query)),data.project).find(p=>p.query===body.query)?.purpose:'official_resolution';
    }
    if(service==='apollo'){const r=data.requests.at(-1);if(r?.service==='apollo')r.purpose='organization_resolution';}
    if(service==='ai'){
      const request=data.requests.filter((r:any)=>r.service===service&&JSON.stringify(r.requestBody)===JSON.stringify(body)).at(-1);
      if(request)request.purpose=stage==='extract'?'entity_extraction':'buyer_verification';
    }
    return response;
  },{commit:()=>raw.commit()});
  const api=providers(allowed,{...config,searchProvider:'langsearch',searchResultCount:10,searchTextCharacters:1500,
    discoveryExclusions:(context:any={})=>{
      const e=data.sourcePipeline?.entities.find((e:any)=>e.id===context.entityId);
      return e&&newPlan?locatorExclusions(data,e,context.purpose,history):providerExclusions('langsearch',[...new Set([...history,...relatedExclusions('',[],data.companies),...referenceDomains(data)])]);
    },
    readWebsite:async(url:string)=>{
      const cached=data.requests.some((r:any)=>r.service==='public_web'&&r.requestBody.url===url&&r.status==='done'&&Date.parse(r.expiresAt)>Date.now());
      if(!cached&&fresh().filter((r:any)=>r.service==='public_web').length>=10&&url!==scope.additionalPublicPageUrl)throw new ProviderError('追加额度仅用于已批准的门店页面','访问受限／未接入');
      if(!cached&&fresh().filter((r:any)=>r.service==='public_web').length>=scope.maxPublicPagesPerCampaign)throw new ProviderError('本轮官网核实次数已到','访问受限／未接入');
      return cachedPublicPage(data,url,checkpoint,{...config,renderEmptyHtml:config.renderEmptyHtml===true},config.renderEmptyHtml?(address:string)=>loadPublicPage(address,undefined,renderEmptyPublicPage):config.publicPageLoader);
    }});
  Object.assign(api,{organizations:async(name:string)=>{const e=data.sourcePipeline.entities.find((e:any)=>e.name===name);if(!e)throw Error('ENTITY_NOT_FOUND');return locateOrganizations(allowed,e);}});
  try{
    if(config.targetPageUrl){
      const e=data.sourcePipeline.entities.find((e:any)=>e.id===config.targetEntityId),page=await api.read(config.targetPageUrl,'网页');
      if(new URL(page.url).hostname!==new URL(e.website).hostname)throw Error('门店页面重定向归属待核实');
      e.websitePages ||= [];e.websitePages.push({...page,retrievedAt:new Date().toISOString()});await checkpoint();await save('partial','门店页面已保存，尚需核实当地经营和买方关系。');return;
    }
    const message=await buyerPipeline(data,stage,api,checkpoint,config.targetEntityId,resolutionPlan,scope.allowedEntityIds,config.renderEmptyHtml===true);await save('partial',message);
  }
  catch(e){await save('blocked',(e as Error).message);}
}
