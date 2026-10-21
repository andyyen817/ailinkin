import http from 'node:http';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {publicTarget} from './public-page-policy.mjs';
import {ProviderError} from './http.mjs';
const nextHost=new Map();
/** @param {string} raw @param {{resolver?:(hostname:string,options:{all:true})=>Promise<Array<{address:string,family?:number}>>,factory?:any,limit?:number,timeoutMs?:number,binary?:boolean,acceptResponse?:Function}} options */
export async function pinnedGet(raw,{resolver=lookup,factory,limit=1048576,timeoutMs=8000,binary=false,acceptResponse}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>20000)throw new ProviderError('INVALID_PUBLIC_REQUEST_TIMEOUT','待核实');
 const hostname=new URL(raw).hostname;
 const target=publicTarget(raw,await resolver(hostname,{all:true}));
 const due=Math.max(Date.now(),nextHost.get(hostname)||0);nextHost.set(hostname,due+1000);
 if(due-Date.now()>10000)throw new ProviderError('官网读取正在限速，请稍后继续','待重试',new Date(due).toISOString());
 if(due>Date.now())await new Promise(r=>setTimeout(r,due-Date.now()));
 const request=factory||(target.url.protocol==='https:'?https.request:http.request);
 return new Promise((resolve,reject)=>{
  let timer;
  const req=request(target.url,{method:'GET',agent:false,headers:{'User-Agent':'AilinkinResearch/1.0 (public company research)','Accept':binary?'application/pdf,text/html,text/plain;q=0.9':'text/html,text/plain;q=0.9','Accept-Encoding':'identity'},
   lookup:(_host,options,callback)=>options?.all?callback(null,target.addresses):callback(null,target.addresses[0].address,target.addresses[0].family)},res=>{
   try{acceptResponse?.(res.headers,res.statusCode);}catch(e){clearTimeout(timer);res.destroy();reject(e);return;}
   let bytes=0;const chunks=[];
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>limit)req.destroy(new ProviderError('官网响应超过读取上限','待核实'));else chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>{clearTimeout(timer);const body=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.headers,text:body.toString('utf8'),...(binary?{bytes:body}:{}),url:target.url.href});});
  });
  timer=setTimeout(()=>req.destroy(new ProviderError('官网读取超时','待核实')),timeoutMs);
  req.on('error',e=>{clearTimeout(timer);reject(e);});req.end();
 });
}
export async function publicGet(url,options={}){
 let current=url;const maximum=options.maxRequests??6;
 if(!Number.isInteger(maximum)||maximum<1||maximum>6)throw Error('INVALID_PUBLIC_REQUEST_LIMIT');
 for(let i=0;i<maximum;i++){
  await options.beforeRequest?.({url:current});
  const result=await pinnedGet(current,options);
  if(options.followRedirects===false)return {...result,networkRequests:i+1};
  if([301,302,303,307,308].includes(result.status)){
   if(!result.headers.location)throw new ProviderError('官网重定向缺少地址','待核实');
   current=new URL(result.headers.location,current).href;continue;
  }
  return {...result,networkRequests:i+1};
 }
 throw new ProviderError('官网重定向或网络请求额度已到','待核实');
}
