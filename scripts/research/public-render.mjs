import {chromium} from 'playwright';
import {publicUrl,ProviderError} from './http.mjs';
import {robotsPolicy} from './public-page-policy.mjs';
export async function renderEmptyPublicPage(url,robots){
 const address=await publicUrl(url),origin=new URL(address).origin;
 const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'}),page=await context.newPage();
 let requests=0,blocked=0;
 try{
  await context.route('**/*',async route=>{
   const req=route.request();let allowed=false;
   try{allowed=req.method()==='GET'&&new URL(req.url()).origin===origin&&robotsPolicy(robots,req.url()).allowed&&requests<20;if(allowed)await publicUrl(req.url());}catch{allowed=false;}
   if(!allowed){blocked++;return route.abort();}requests++;return route.continue();
  });
  const response=await page.goto(address,{waitUntil:'domcontentloaded',timeout:20000});
  if(response?.status()!==200)throw new ProviderError('动态页面未返回正常正文','待核实');
  await page.waitForFunction(()=>document.body?.innerText?.trim().length>=20,{},{timeout:8000}).catch(()=>{});
  const result=await page.evaluate(()=>({url:location.href,content:document.body?.innerText?.trim().slice(0,23000)||'',links:[...document.querySelectorAll('a[href]')].map(a=>a.href),linkDetails:[...document.querySelectorAll('a[href]')].map(a=>({url:a.href,label:a.innerText.trim().slice(0,150)}))}));
  if(new URL(result.url).origin!==origin||result.content.length<20||/captcha|access denied|verify you are human|请完成验证/i.test(result.content.slice(0,1000)))throw new ProviderError('动态正文仍不足或要求访问验证，停止读取','访问受限／未接入');
  return {...result,links:[...new Set(result.links)].filter(s=>/^https?:\/\//i.test(s)).slice(0,100),linkDetails:result.linkDetails.slice(0,100),readScope:'public_rendered_page',networkRequests:requests,blockedRequests:blocked};
 }finally{await context.close();await browser.close();}
}
