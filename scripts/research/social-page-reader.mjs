import {chromium} from 'playwright';
import {publicGet} from './public-page-client.mjs';
import {publicUrl,ProviderError} from './http.mjs';
import {robotsPolicy} from './public-page-policy.mjs';
import {contactText,htmlContactText,accessBarrier} from './contact-text-extractor.mjs';
import {captureContactRegions} from './contact-capture.mjs';
export function allowedSocialResource({url,method,type},{origin,robots,allowImages=false}){
  try{return method==='GET'&&new URL(url).origin===origin&&robotsPolicy(robots,url).allowed&&
    !['media','websocket','eventsource'].includes(type)&&(allowImages||type!=='image')&&!/\.(?:mp4|webm|m3u8|mp3)(?:[?#]|$)/i.test(url);}catch{return false;}
}
/** @param {string} url @param {string} robots @param {{companyId?:string,maxImages?:number,maxNetworkRequests?:number,beforeRequest?:Function,launch?:Function,resolvePublic?:Function}} options */
export async function renderSocialText(url,robots,{companyId,maxImages=0,maxNetworkRequests=20,beforeRequest,
  launch=()=>chromium.launch({channel:'chrome',headless:true}),resolvePublic=publicUrl}={}){
  const address=await resolvePublic(url),origin=new URL(address).origin,started=Date.now();
  const browser=await launch();
  const context=await browser.newContext({viewport:{width:1200,height:800},acceptDownloads:false,serviceWorkers:'block'}),page=await context.newPage();
  let networkRequests=0,blockedRequests=0,reservedNetwork=0,guardError=null;
  try{
    await context.route('**/*',async route=>{
      const r=route.request();let allowed=networkRequests+reservedNetwork<maxNetworkRequests&&allowedSocialResource({url:r.url(),method:r.method(),type:r.resourceType()},{origin,robots,allowImages:maxImages>0});
      if(r.resourceType()==='image')allowed=false;
      if(allowed){reservedNetwork++;try{await resolvePublic(r.url());await beforeRequest?.({url:r.url()});}catch(e){allowed=false;guardError=e;}finally{reservedNetwork--;}}
      if(!allowed){blockedRequests++;return route.abort();}networkRequests++;return route.continue();
    });
    const response=await page.goto(address,{waitUntil:'domcontentloaded',timeout:20000});
    if(guardError)throw guardError;
    await page.waitForFunction(()=>document.body?.innerText?.trim().length>20,{},{timeout:5000}).catch(()=>{});
    const snapshots=[];
    for(let step=0;step<3;step++){
      snapshots.push(await page.evaluate(()=>({text:document.body?.innerText||'',url:location.href,
        links:[...document.querySelectorAll('a[href]')].map(a=>({url:a.href,label:a.textContent||''})).slice(0,1001)})));
      if(accessBarrier(snapshots.at(-1).text,response?.status()||0))break;
      if(step<2){await page.evaluate(()=>window.scrollBy(0,window.innerHeight));await page.waitForTimeout(250);}
    }
    const visible={url:snapshots.at(-1).url,text:[...new Set(snapshots.map(s=>s.text))].join('\n'),
      links:[...new Map(snapshots.flatMap(s=>s.links).map(l=>[l.url,l])).values()]};
    const barrier=accessBarrier(visible.text,response?.status()||0);
    if(barrier||!response?.ok()||new URL(visible.url).origin!==origin)throw new ProviderError('社媒页面受限：'+(barrier||'redirect_or_status'),'访问受限／未接入');
    const text=contactText({...visible,companyId}),images=maxImages?await captureContactRegions(page,{maxImages,sourceUrl:visible.url}):[];
    return {...text,url:visible.url,links:visible.links,images,method:'public_browser',networkRequests,blockedRequests,
      elapsedMs:Date.now()-started,nodeRssBytes:process.memoryUsage().rss,
      coverage:{...text.coverage,complete:false,scrollSteps:snapshots.length,reason:'bounded_public_text_no_full_history'}};
  }finally{await context.close();await browser.close();}
}
/** @param {string} url @param {{companyId?:string,browser?:boolean,maxImages?:number,maxNetworkRequests?:number,beforeRequest?:Function}} options */
export async function readSocialPage(url,{companyId,browser=false,maxImages=0,maxNetworkRequests=32,beforeRequest}={},get=publicGet,render=renderSocialText){
  if(!Number.isInteger(maxNetworkRequests)||maxNetworkRequests<2||maxNetworkRequests>32)throw Error('INVALID_SOCIAL_NETWORK_LIMIT');
  const origin=new URL(url).origin,robots=await get(origin+'/robots.txt',{limit:512000,maxRequests:Math.min(6,maxNetworkRequests),beforeRequest});
  if(robots.status!==200&&![404,410].includes(robots.status))throw new ProviderError('社媒 robots 状态无法确认','访问受限／未接入');
  const policy=robotsPolicy(robots.status===200?robots.text:'',url);
  if(!policy.allowed||policy.delay>10)throw new ProviderError('社媒路径禁止读取或需较长等待','访问受限／未接入');
  if(policy.delay>1)await new Promise(r=>setTimeout(r,policy.delay*1000));
  const remaining=maxNetworkRequests-(robots.networkRequests||1);if(remaining<1)throw new ProviderError('社媒网络额度已到','待核实');
  const page=await get(url,{maxRequests:Math.min(6,remaining),beforeRequest}),network=(robots.networkRequests||1)+(page.networkRequests||1);
  if(network>maxNetworkRequests)throw new ProviderError('社媒网络额度已到','待核实');
  if(page.status!==200||accessBarrier(page.text,page.status))throw new ProviderError('社媒页面拒绝访问或要求验证，停止读取','访问受限／未接入');
  if(new URL(page.url||url).origin!==origin||!/text\/(?:html|plain)/i.test(page.headers?.['content-type']||''))throw new ProviderError('社媒跳转或内容类型待核实','待核实');
  const parsed=htmlContactText(page.text,page.url||url),result=contactText({url:page.url||url,...parsed,companyId});
  if(browser&&result.coverage.charactersRead<80&&network<maxNetworkRequests){
    const r=await render(url,robots.status===200?robots.text:'',{companyId,maxImages,maxNetworkRequests:Math.min(20,maxNetworkRequests-network),beforeRequest});
    if(network+r.networkRequests>maxNetworkRequests)throw new ProviderError('社媒网络额度已到','待核实');return {...r,networkRequests:network+r.networkRequests};
  }
  return {...result,url:page.url||url,links:parsed.links,images:[],method:'public_html',networkRequests:network};
}
