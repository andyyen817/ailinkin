import {z} from 'zod';
import {hash} from './core.mjs';
import {transport,ProviderError} from './http.mjs';
import {readSocialPage} from './social-page-reader.mjs';
import {contactVision,contactExtractionKey} from './contact-vision.mjs';
import {accountIdentity} from './contact-evidence-validator.mjs';
import {savedOfficialContactPage} from './contact-official-fallback.mjs';
import {diagnoseContactFailure,recoveryActions,contactOutcome,modelRecoveryActions} from './contact-recovery.mjs';
const url=z.url().refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port;});
export const contactScope=z.object({id:z.string().regex(/^CONTACT-[A-Z0-9-]{1,80}$/),enabled:z.literal(true),
  tenantId:z.uuid(),campaignId:z.uuid(),companyId:z.string().regex(/^C-[a-f0-9-]{36}$/),platform:z.string().min(1),url,
  approvedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),pageReads:z.literal(1),modelRequests:z.number().int().min(0).max(1),
  screenshots:z.number().int().min(0).max(4),maxSpendUsd:z.number().min(0).max(0.05),model:z.literal('deepseek-flash'),browser:z.boolean(),send:z.literal(false),
  savedOfficialFallback:z.boolean().optional()}).strict();
export function checkContactScope(raw,{tenantId,campaignId,companyId,platform,url:address},now=Date.now()){
  const s=contactScope.parse(raw);
  if(s.tenantId!==tenantId||s.campaignId!==campaignId||s.companyId!==companyId||s.platform!==platform||s.url!==address)throw Error('CONTACT_SCOPE_MISMATCH');
  if(Date.parse(s.approvedAt)>now||Date.parse(s.expiresAt)<=now||Date.parse(s.expiresAt)-Date.parse(s.approvedAt)>3600000)throw Error('CONTACT_SCOPE_EXPIRED');
  if(s.modelRequests&&s.maxSpendUsd<0.05)throw Error('CONTACT_MODEL_RESERVATION_REQUIRED');return s;
}
/** @param {any} data @param {any} input @param {Function} checkpoint @param {{keys?:Record<string,string|undefined>,readPage?:(url:string,options:any)=>Promise<any>,putImage?:(bytes:Buffer)=>Promise<any>,loadImage?:(id:string)=>Promise<Buffer>,fetcher?:typeof fetch,now?:()=>number,beforeSend?:(item:any)=>Promise<any>,savedPage?:any}} options */
export async function executeContactResearch(data,{tenantId,campaignId,company,account,scope:rawScope},checkpoint,
  {keys={},readPage=readSocialPage,putImage,loadImage,fetcher=fetch,now=()=>Date.now(),beforeSend,savedPage=null}={}){
  const expected={tenantId,campaignId,companyId:company.id,platform:account.platform,url:account.url};
  const scope=checkContactScope(rawScope,expected,now()),runs=data.contactResearchRuns||=[];
  if(runs.some(r=>r.requests?.some(q=>['unknown','pending'].includes(q.status))))throw Error('CONTACT_REQUEST_UNKNOWN');
  const pageKey=hash(JSON.stringify(['contact-public-v1',company.id,account.platform,account.url,scope.browser,scope.screenshots]));
  const old=runs.findLast(r=>r.pageKey===pageKey&&r.state==='done'&&Date.parse(r.expiresAt)>now());
  if(old&&(!scope.modelRequests||old.extraction?.extractionKey===contactExtractionKey({company,blocks:old.page.blocks,images:old.images})))return {run:old,reused:true};
  if(runs.some(r=>r.scopeId===scope.id))throw Error('CONTACT_SCOPE_ALREADY_USED');
  if(savedPage&&(savedPage.url!==account.url||!savedPage.sourceCache||savedPage.networkRequests!==0||savedPage.blocks?.some(b=>new URL(b.sourceUrl).href.replace(/\/$/,'')!==new URL(account.url).href.replace(/\/$/,''))))throw Error('CONTACT_CACHE_SOURCE_MISMATCH');
  if(!old&&!savedPage)await beforeSend?.({service:'social_public',requestKey:pageKey,reservedCost:0});
  const run={id:'CE-'+hash(scope.id).slice(0,24),scopeId:scope.id,companyId:company.id,companyName:company.name,platform:account.platform,url:account.url,
    pageKey,state:'running',createdAt:new Date(now()).toISOString(),requests:[],images:[],people:[],channels:[],unknowns:[],
    limits:{pageReads:scope.pageReads,modelRequests:scope.modelRequests,screenshots:scope.screenshots,maxSpendUsd:scope.maxSpendUsd,networkRequestsUpperBound:32},sent:0,events:[]};
  runs.push(run);
  const item={id:'CP-'+pageKey.slice(0,24),key:pageKey,service:savedPage?'social_cache':'social_public',status:'pending',route:account.url,requestBody:{url:account.url},reservedCost:0,measuredCost:0,startedAt:new Date(now()).toISOString()};
  run.requests.push(item);await checkpoint();
  try{
    let page;
    try{page=old?structuredClone(old.page):savedPage?structuredClone(savedPage):await readPage(account.url,{companyId:company.id,browser:scope.browser,maxImages:scope.screenshots});}
    catch(error){
      item.status=error instanceof ProviderError?'failed':'unknown';item.failure={message:String(error?.message||error),...diagnoseContactFailure(error)};
      run.events.push({action:'source_failed',source:account.url,diagnosis:item.failure.kind});await checkpoint();
      const fallback=scope.savedOfficialFallback?savedOfficialContactPage(data,company,now()):null;
      run.recoveryPlan=recoveryActions({diagnosis:item.failure,savedPages:fallback?.sourcePageUrls.length||0,modelAvailable:!!scope.modelRequests,remainingReads:0});
      if(!fallback)throw error;
      page=fallback;run.fallbackUsed=true;run.events.push({action:'reuse_saved_official',sources:fallback.sourcePageUrls,externalRequests:0});
      if(item.status==='unknown')page={...page,state:'blocked',reason:'原读取结果未知，只复用已存资料，不追加模型请求。'};
    }
    if(old){run.sourceCacheHit=true;run.images=structuredClone(old.images);item.service='social_cache';}
    const {images=[],...saved}=page;if(!run.fallbackUsed){item.response=saved;item.status='done';}run.page=saved;run.identity=accountIdentity(account,page,company);
    if(images.length>scope.screenshots)throw Error('CONTACT_SCREENSHOT_LIMIT');
    for(const image of images){const meta=await putImage(image.bytes);const {bytes,...source}=image;run.images.push({...source,...meta});}
    run.channels=page.channels||[];run.coverage=page.coverage;run.sourceCacheHit=!!old||!!savedPage;await checkpoint();
    if(page.state==='blocked'||page.state==='empty'){run.state='blocked';run.reason=page.reason||'NO_READABLE_CONTACT_TEXT';}
    else if(scope.modelRequests){
      checkContactScope(rawScope,expected,now());
      const input={company,blocks:page.blocks,images:run.images,loadImage},key=contactExtractionKey(input);
      const extracted=runs.findLast(r=>r.extraction?.extractionKey===key&&r.state==='done');
      if(extracted)run.extraction=structuredClone(extracted.extraction);
      else{
        const ledger={requests:run.requests,project:{maxRequests:2,maxSpendUsd:scope.maxSpendUsd}};
        const call=transport(ledger,{keys,live:true,costUpperBound:{ai:0.05},cacheSeconds:{ai:86400},beforeSend},checkpoint,fetcher);
        run.extraction=await contactVision(call,input);call.commit();
      }
      run.people=run.extraction.people;run.unknowns=run.extraction.unknowns;run.state='done';
      run.recoveryPlan=[...(run.recoveryPlan||[]),...modelRecoveryActions(run.extraction.recommendations||[])];
    }else{run.state='done';run.unknowns=['本范围未允许模型整理；仅保存公开文字及明确联系链接。'];}
    run.outcome=contactOutcome(run);run.expiresAt=new Date(now()+86400000).toISOString();run.finishedAt=new Date(now()).toISOString();await checkpoint();return {run,reused:false};
  }catch(e){
    if(item.status==='pending')item.status=e instanceof ProviderError?'failed':'unknown';
    run.state=run.requests.some(q=>q.status==='unknown'||q.status==='pending')?'unknown':'blocked';
    run.reason=e instanceof Error?e.message:'CONTACT_RESEARCH_FAILED';run.recoveryPlan||=recoveryActions({diagnosis:diagnoseContactFailure(e),savedPages:0});run.outcome=contactOutcome(run);await checkpoint();throw e;
  }
}
