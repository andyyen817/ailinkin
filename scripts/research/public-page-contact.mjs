import {browserPlatformUrl,browserPageState} from './browser-contact-policy.mjs';
import {collectVisibleContact} from './browser-contact-driver.mjs';
import {publicRobots} from './public-search-browser.mjs';
import {knownHtmlRobots,publicPreviewAllowedUrl} from './public-account-entry.mjs';
export async function readPublicContactPage(s,company,target,{personName=''}={}){
  if(!s.anonymous||!browserPlatformUrl(s.platform,target.url)||!target.evidence?.length)throw Error('PUBLIC_PAGE_EVIDENCE_REQUIRED');
  s.stage='social';const permission=await publicRobots(s,target.url);
  const preview=s.singlePublicPreviewAuthorizedUrl===target.url&&publicPreviewAllowedUrl(s.scope,target.url)&&!s.publicPreviewUsed&&
    permission.state==='robots_unknown'&&knownHtmlRobots(permission.robotsEvidence,true);
  if(permission.state!=='ready'&&!preview)return {...permission,fresh:false,url:target.url,blocks:[],channels:[],images:[]};
  if(s.usage.pageReads>=s.scope.maxPageReads||s.usage.networkRequests>=s.scope.maxNetworkRequests)return {state:'budget_exhausted',fresh:false};
  if(permission.delay>5)return {state:'rate_limited',fresh:false,url:target.url,reason:'crawl_delay_requires_later_batch',blocks:[],channels:[],images:[]};
  await s.page.waitForTimeout((permission.delay||0)*1000);
  const proof={url:target.url,robotsEvidence:permission.robotsEvidence,publicPreview:preview?{singleUrl:true,robotsState:'unknown_html'}:null};
  let navigation=null;
  try{
    s.events.push({action:'open_public_source',url:target.url,evidence:target.evidence,at:new Date().toISOString()});
    const response=await s.page.goto(target.url,{waitUntil:'domcontentloaded',timeout:20000});s.lastStatus=response?.status()||0;
    navigation={requestedUrl:target.url,finalUrl:s.page.url(),httpStatus:s.lastStatus,contentType:response?.headers?.()['content-type']||null};
    s.events.push({action:'public_navigation_response',...navigation,at:new Date().toISOString()});
    await s.page.waitForTimeout(700);
    const body=await s.page.locator('body').innerText();
    const state=browserPageState({text:body,passwordVisible:await s.page.locator('input[type=password]').first().isVisible().catch(()=>false),status:s.lastStatus});
    if(state!=='ready')return {...proof,navigation,state,fresh:false,reason:state,blocks:[],channels:[],images:[]};
    if(/log in to (?:continue|see|view)|sign in to (?:continue|see|view)|登录后|登入後|加入.*登录|用 Instagram 登录/i.test(body))return {...proof,navigation,state:'needs_login',fresh:false,reason:'anonymous_public_entry_requires_login',blocks:[],channels:[],images:[]};
    const dialogs=s.page.getByRole('dialog');for(let i=0;i<Math.min(await dialogs.count(),3);i++)if(await dialogs.nth(i).isVisible())return {...proof,navigation,state:'needs_user_action',fresh:false,reason:'visible_dialog_obstructs_public_content',blocks:[],channels:[],images:[]};
    const main=s.page.locator('main,[role="main"]').first();
    if(await main.count())for(const role of ['button','tab']){const controls=main.getByRole(role,{name:/^(see more|show more|experience|contact info|lihat lainnya|pengalaman|更多|工作经历)$/i});
      for(let i=0;i<Math.min(await controls.count(),2);i++){const item=controls.nth(i);if(await item.isVisible()){await item.click({timeout:3000}).catch(()=>{});s.events.push({action:'expand_public_region',label:await item.innerText(),at:new Date().toISOString()});}}}
    const result=await collectVisibleContact(s,company,{personName,maxImages:1});
    return {...proof,...result,sourceType:'social_body',method:'anonymous_public_browser',sourceEvidence:target.evidence,navigation,searchSubmitted:s.events.some(e=>e.action==='public_search_submitted')};
  }catch(e){return {...proof,navigation,state:'read_failed',fresh:false,reason:String(e.message||e).split('\n')[0],blocks:[],channels:[],images:[]};}
}
