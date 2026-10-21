import {publicGet} from './public-page-client.mjs';
import {robotsPolicy} from './public-page-policy.mjs';
import {ProviderError} from './http.mjs';
import {httpUrl,id} from './schema.mjs';
import {hash} from './core.mjs';
const decode=s=>s.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[a-f0-9]+);/gi,x=>{
 const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};if(named[x.toLowerCase()])return named[x.toLowerCase()];
 const n=x[2]?.toLowerCase()==='x'?parseInt(x.slice(3),16):parseInt(x.slice(2),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
});
/** @returns {{url:string,content:string,links:string[],readScope:string,linkDetails?:Array<{url:string,label:string}>}} */
export function pageContent(html,url){
 const clean=html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');
 const links=[],contactLinks=[],linkDetails=[];
 for(const m of clean.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  try{const u=new URL(decode(m[1]),url);u.hash='';if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)
   linkDetails.push({url:u.href,label:decode(m[2].replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim().slice(0,150)});}catch{}
 }
 for(const m of clean.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)){
  try{const u=new URL(decode(m[1]??m[2]??m[3]),url);u.hash='';
   if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)links.push(u.href);
   else if(['mailto:','tel:'].includes(u.protocol))contactLinks.push(u.href.split('?')[0]);
  }catch{}
 }
 const content=decode(clean.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim().slice(0,23000);
 if(content.length<20||/captcha|access denied|verify you are human|请完成验证/i.test(content.slice(0,600)))throw new ProviderError('页面正文不足或要求访问验证','访问受限／未接入');
 return {url,content:content+(contactLinks.length?'\n公开联系方式链接：'+[...new Set(contactLinks)].slice(0,20).join('；'):''),links:[...new Set(links)].slice(0,100),linkDetails:linkDetails.slice(0,100),readScope:'public_html_page'};
}
export async function loadPublicPage(url,get=publicGet,render){
 const origin=new URL(url).origin,robots=await get(origin+'/robots.txt',{limit:512000});let delay=1;
 if(robots.status===200){const policy=robotsPolicy(robots.text,url);if(!policy.allowed)throw new ProviderError('官网robots规则禁止读取该路径','访问受限／未接入');delay=policy.delay;}
 else if(![404,410].includes(robots.status))throw new ProviderError('robots规则暂不能确认，HTTP '+robots.status,'访问受限／未接入');
 if(delay>10)throw new ProviderError('官网要求较长读取间隔，请稍后继续','待重试',new Date(Date.now()+delay*1000).toISOString());
 if(delay>1)await new Promise(r=>setTimeout(r,delay*1000));
 const page=await get(url);
 if(page.status!==200){const retry=Number(page.headers?.['retry-after']);throw new ProviderError('官网返回 HTTP '+page.status,[401,403,429].includes(page.status)?'访问受限／未接入':'待核实',page.status===429?new Date(Date.now()+Math.max(60,retry||60)*1000).toISOString():undefined);}
 if(page.headers?.['content-encoding']&&page.headers['content-encoding']!=='identity')throw new ProviderError('官网响应压缩格式尚未支持','待核实');
 if(!/text\/(html|plain)/i.test(String(page.headers?.['content-type'])))throw new ProviderError('当前只读取公开HTML或文字页面','访问受限／未接入');
 try{return {...pageContent(page.text,page.url||url),networkRequests:(robots.networkRequests||1)+(page.networkRequests||1)};}
 catch(error){
  const visible=page.text.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  const challenge=/captcha|access denied|verify you are human|cf-chl|challenge-platform|请完成验证/i.test(page.text);
  error.diagnostic={visibleCharacters:visible.length,challengeDetected:challenge,renderEnabled:Boolean(render),observedUrl:page.url||url};
  if(!render||challenge||visible.length>=20)throw error;
  const rendered=await render(page.url||url,robots.status===200?robots.text:'');
  return {...rendered,networkRequests:(robots.networkRequests||1)+(page.networkRequests||1)+(rendered.networkRequests||1)};
 }
}
export async function cachedPublicPage(data,url,checkpoint,config={},load=loadPublicPage){
 const address=new URL(httpUrl(url));address.hash='';const body={url:address.href,...(config.renderEmptyHtml?{mode:'render_empty_html'}:{})},key=hash(JSON.stringify(['public_web',body]));
 const previous=data.requests.filter(r=>r.key===key).at(-1)||await config.lookupRequest?.(key);
 if(previous?.status==='done'&&Date.parse(previous.expiresAt)>Date.now()&&previous.response?.content){data.cacheHits=(data.cacheHits||0)+1;await checkpoint();return previous.response;}
 if(['pending','unknown'].includes(previous?.status))throw new ProviderError('前次官网读取结果未知，需核对后恢复','待核实');
 if(previous?.status==='failed'&&Date.parse(previous.response?.retryAt)>Date.now())throw new ProviderError(previous.response.reason,previous.response.errorStatus,previous.response.retryAt);
 if(data.requests.length>=data.project.maxRequests)throw new ProviderError('官网读取请求上限已到','访问受限／未接入');
 const item={id:id('Q'),key,service:'public_web',route:address.href,requestBody:body,status:'pending',reservedCost:0,reservedCredits:0,measuredCost:0,actualCostUsd:0,startedAt:new Date().toISOString()};
 data.requests.push(item);await checkpoint();
 try{item.response=await load(address.href);item.status='done';item.applied=true;item.expiresAt=new Date(Date.now()+86400000).toISOString();}
 catch(e){item.status=e instanceof ProviderError?'failed':'unknown';item.response={reason:e instanceof ProviderError?e.message:'官网网络读取结果未知',errorStatus:e.status||'待核实',retryAt:e.retryAt||new Date(Date.now()+3600000).toISOString(),...(e.diagnostic?{diagnostic:e.diagnostic}:{})};await checkpoint();throw e;}
 await checkpoint();return item.response;
}
