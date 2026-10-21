import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {publicUrl} from './http.mjs';
import {browserHome,browserReadResource,browserPageState,browserPlatformUrl,anonymousResource} from './browser-contact-policy.mjs';
import {robotsPolicy} from './public-page-policy.mjs';
import {publicRobotsResponse} from './public-robots-response.mjs';
import {publicPreviewNavigation} from './public-account-entry.mjs';
const sessions=globalThis.__ailinkinVisibleSocialSessions ||= new Map();
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function browserSessionKey(tenantId,operatorId){if(!uuid.test(tenantId)||!uuid.test(operatorId))throw Error('BROWSER_IDENTITY_INVALID');return tenantId+'/'+operatorId;}
export async function closeBrowserSession(tenantId,operatorId){const key=browserSessionKey(tenantId,operatorId),s=sessions.get(key);if(!s)return false;clearTimeout(s.timer);sessions.delete(key);await s.context.close();await s.browser?.close();return true;}
export async function browserState(s){
  const text=await s.page.locator('body').innerText({timeout:3000}).catch(()=>''),passwordVisible=await s.page.locator('input[type=password]').first().isVisible().catch(()=>false);
  return browserPageState({text:text.slice(0,3000),passwordVisible,status:s.lastStatus});
}
/** Visible browser profile is private to this tenant and account holder. No cookies are exported. */
export async function openBrowserSession(scope,platform,{launch=(profile,options)=>chromium.launchPersistentContext(profile,options),anonymousLaunch=options=>chromium.launch(options),resolvePublic=publicUrl,initialUsage={}}={}){
  const key=browserSessionKey(scope.tenantId,scope.operatorId),expiry=Date.parse(scope.expiresAt);
  if(!Number.isFinite(expiry)||expiry<=Date.now())throw Error('BROWSER_SCOPE_EXPIRED');
  let s=sessions.get(key);
  if(s&&(s.scope.id!==scope.id||s.expiresAt<=Date.now())){await closeBrowserSession(scope.tenantId,scope.operatorId);s=null;}
  if(!s){
    const anonymous=scope.mode==='anonymous_public',root=path.resolve('.runtime/social-browser'),profile=path.join(root,scope.tenantId,scope.operatorId);
    if(!anonymous){await fs.mkdir(profile,{recursive:true,mode:0o700});
      for(const p of [root,path.dirname(profile),profile])if((await fs.lstat(p)).isSymbolicLink())throw Error('BROWSER_PROFILE_LINK_REJECTED');}
    const usage={networkRequests:0,blockedRequests:0,pageReads:0,screenshots:0,searchQueries:0};
    for(const k of Object.keys(usage)){const value=Number(initialUsage[k]||0);if(!Number.isSafeInteger(value)||value<0)throw Error('BROWSER_USAGE_INVALID');usage[k]=value;}
    if(usage.networkRequests>=scope.maxNetworkRequests||usage.pageReads>=scope.maxPageReads)throw Error('BROWSER_BUDGET_REACHED');
    const browser=anonymous?await anonymousLaunch({channel:'chrome',headless:false}):null;
    const options={viewport:{width:1280,height:900},acceptDownloads:false,serviceWorkers:'block'};
    const context=anonymous?await browser.newContext(options):await launch(profile,{...options,channel:'chrome',headless:false});
    const initialCookieCount=anonymous?(await context.cookies()).length:null;
    if(anonymous&&initialCookieCount){await context.close();await browser.close();throw Error('ANONYMOUS_CONTEXT_NOT_EMPTY');}
    s={context,browser,anonymous,initialCookieCount,page:context.pages()[0]||await context.newPage(),key,scope,platform,expiresAt:expiry,manual:!anonymous,busy:false,
      stage:anonymous?'search':'social',engine:scope.engines?.[0],resolvePublic,usage,events:[],lastStatus:200,reservedNetwork:0,reservedPages:0,robots:new Map()};
    s.page.on('response',response=>{const r=response.request();if(r.isNavigationRequest()&&r.frame()===s.page.mainFrame())s.lastStatus=response.status();});
    sessions.set(key,s);s.timer=setTimeout(()=>void closeBrowserSession(scope.tenantId,scope.operatorId).catch(()=>{}),expiry-Date.now());
    context.on('close',()=>{clearTimeout(s.timer);if(sessions.get(key)===s)sessions.delete(key);});
    await context.route('**/*',async route=>{
      const req=route.request();let operation=req.headers()['x-fb-friendly-name']||'';
      if(req.method()==='POST'&&!s.manual&&!operation){try{operation=JSON.parse(req.postData()||'{}').operationName||'';}catch{operation=new URLSearchParams(req.postData()||'').get('fb_api_req_friendly_name')||'';}}
      const platform=s.platform,nav=req.isNavigationRequest()&&req.frame()===s.page.mainFrame();
      const authPageVisible=s.manual&&context.pages().some(p=>{try{return ['IG','FB'].some(v=>browserPlatformUrl(v,p.url(),true))&&/\/(accounts\/login|login(?:[/.]|$)|challenge|checkpoint|two_factor)/i.test(new URL(p.url()).pathname);}catch{return false;}});
      let allowed=Date.now()<s.expiresAt&&s.usage.networkRequests+s.reservedNetwork<scope.maxNetworkRequests&&
        (!nav||s.usage.pageReads+s.reservedPages<scope.maxPageReads)&&(s.anonymous?anonymousResource({url:req.url(),method:req.method(),type:req.resourceType(),operation},s):browserReadResource({url:req.url(),method:req.method(),type:req.resourceType(),operation},{platform,manual:s.manual,authPageVisible}));
      if(allowed&&s.anonymous&&nav){const rule=s.robots.get(new URL(req.url()).origin);allowed=!!rule?.checked&&[200,404,410].includes(rule.status)&&robotsPolicy(rule.status===200?rule.text:'',req.url()).allowed||publicPreviewNavigation(s,req.url());}
      if(allowed){s.reservedNetwork++;if(nav)s.reservedPages++;
        try{await resolvePublic(req.url());allowed=Date.now()<s.expiresAt&&s.platform===platform;}catch{allowed=false;}
        finally{s.reservedNetwork--;if(nav)s.reservedPages--;}}
      if(!allowed){s.usage.blockedRequests++;const host=new URL(req.url()).hostname,type=req.resourceType();
        if(!s.events.some(e=>e.action==='resource_blocked'&&e.host===host&&e.type===type)&&s.events.filter(e=>e.action==='resource_blocked').length<40)
          s.events.push({action:'resource_blocked',host,path:new URL(req.url()).pathname,type,method:req.method(),at:new Date().toISOString()});
        if(type==='image')return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'});return route.abort();}
      try{await s.beforePublicRequest?.({url:req.url()});}catch{return route.abort();}
      s.usage.networkRequests++;
      if(nav)s.usage.pageReads++;
      return route.continue();
    });
  }
  if(s.busy)throw Error('BROWSER_SESSION_BUSY');
  s.platform=platform;s.manual=!s.anonymous;s.busy=true;
  try{
    if(s.anonymous){s.events.push({action:'anonymous_context_ready',initialCookieCount:s.initialCookieCount,at:new Date().toISOString()});return s;}
    const address=browserHome(platform);await resolvePublic(address);
    s.events.push({action:'open_platform',platform,at:new Date().toISOString()});
    const response=await s.page.goto(address,{waitUntil:'domcontentloaded',timeout:25000});s.lastStatus=response?.status()||0;
    s.events.push({action:'platform_loaded',platform,state:await browserState(s),at:new Date().toISOString()});return s;
  }finally{s.busy=false;}
}
export function existingBrowserSession(tenantId,operatorId){const s=sessions.get(browserSessionKey(tenantId,operatorId));if(!s||s.expiresAt<=Date.now())throw Error('BROWSER_SESSION_REQUIRED');return s;}
export function browserSessionView(s){return {platform:s.platform,visible:true,mode:s.anonymous?'anonymous_public':'visible_browser_only',initialCookieCount:s.initialCookieCount,usage:{...s.usage},events:s.events.slice(-60),expiresAt:new Date(s.expiresAt).toISOString(),busy:s.busy};}
export async function readBrowserRobots(s,url){
  return publicRobotsResponse(s,url);
}
