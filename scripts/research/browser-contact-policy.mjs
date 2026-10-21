import {platformCatalog} from './platform-catalog.mjs';
const cdn={FB:['fbcdn.net'],IG:['cdninstagram.com','fbcdn.net'],Threads:['cdninstagram.com','fbcdn.net'],LinkedIn:['licdn.com'],X:['twimg.com'],Reddit:['redditstatic.com','redd.it'],TikTok:['tiktokcdn.com','tiktokcdn-us.com','sf16-website-login.neutral.ttwstatic.com'],小红书:['xhscdn.com','xiaohongshu.com']};
export function browserPlatformUrl(platform,url,resource=false){
  try{const u=new URL(url),domains=[...(platformCatalog[platform]?.domains||[]),...(resource?cdn[platform]||[]:[])];
    if(platform==='网页'||u.protocol!=='https:'||u.username||u.password||u.port||!domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))return false;
    return resource||!/(?:^|\/)(?:direct|messages?|chats?|settings|accounts|notifications|compose|intent)(?:\/|$)/i.test(u.pathname);
  }catch{return false;}
}
export function browserReadResource({url,method,type,operation=''},{platform,manual=false,authPageVisible=false}){
  const metaLogin=manual&&['Threads','IG','FB'].includes(platform)&&['IG','FB'].some(p=>browserPlatformUrl(p,url,true));
  if(!(browserPlatformUrl(platform,url,true)||metaLogin)||['media','websocket','eventsource'].includes(type)||type==='image'&&!(metaLogin&&authPageVisible)||/\.(?:mp4|webm|m3u8|mp3)(?:[?#]|$)/i.test(url))return false;
  if(method==='GET')return true;
  // Account holder may log in in the visible window; the worker never enters credentials.
  if(manual&&method==='POST')return true;
  return method==='POST'&&['xhr','fetch'].includes(type)&&/query|search|profile|about|timeline|feed/i.test(operation)&&
    !/mutation|login|send|create|delete|like|follow|comment|message/i.test(operation);
}
export function checkBrowserScope(scope,{tenantId,operatorId,campaignId,companyId,platform},now=Date.now()){
  if(!scope?.enabled||!['visible_browser_only','anonymous_public'].includes(scope.mode)||scope.tenantId!==tenantId||scope.operatorId!==operatorId||!(scope.campaignIds||[scope.campaignId]).includes(campaignId)||
    !scope.companyIds.includes(companyId)||!scope.platforms.includes(platform)||Date.parse(scope.approvedAt)>now||Date.parse(scope.expiresAt)<=now||
    Date.parse(scope.expiresAt)-Date.parse(scope.approvedAt)>3600000)throw Error('BROWSER_SCOPE_REQUIRED');
}
export function browserHome(platform){const host=platformCatalog[platform]?.canonical;if(!host||platform==='网页')throw Error('INVALID_BROWSER_PLATFORM');return 'https://www.'+host+'/';}
export function browserPageState({text,passwordVisible,status=200}){
  if(passwordVisible)return 'needs_login';
  if(status===429||/too many requests|temporarily blocked|rate limit/i.test(text))return 'rate_limited';
  if([401,403].includes(status)||/captcha|verify you are human|access denied|automated requests|验证您是|請完成驗證/i.test(text))return 'restricted';
  return 'ready';
}
const searchHosts={Google:['www.google.com','google.com'],Bing:['www.bing.com','bing.com']};
export function publicSearchUrl(engine,query){
  if(!searchHosts[engine]||typeof query!=='string'||!query.trim()||query.length>600)throw Error('PUBLIC_QUERY_INVALID');
  const u=new URL('https://'+searchHosts[engine][0]+'/search');u.searchParams.set('q',query);return u.href;
}
export function anonymousResource(req,s){
  try{const u=new URL(req.url);if(u.protocol!=='https:'||u.username||u.password||u.port||['media','websocket','eventsource','image'].includes(req.type))return false;
    if(s.stage==='search')return req.method==='GET'&&s.scope.engines?.includes(s.engine)&&
      (searchHosts[s.engine]?.includes(u.hostname)&&/^\/(?:search|robots\.txt|images\/|rp\/)/.test(u.pathname)||u.hostname==='www.gstatic.com'&&s.engine==='Google'&&req.type!=='document');
    if(/\/(?:accounts?|login|signin|oauth|challenge|checkpoint|messages?|direct|settings|compose)(?:\/|$)/i.test(u.pathname))return false;
    return browserReadResource(req,{platform:s.platform,manual:false});
  }catch{return false;}
}
