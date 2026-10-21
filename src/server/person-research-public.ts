import 'server-only';
import {readSocialPage} from '../../scripts/research/social-page-reader.mjs';
import {relevantPersonText} from './person-research-plan';import {personHash} from './person-research-selection';
import {extractPublicPerson,observedPersonLinks} from './person-public-extraction';
export function personSourceCandidates(person:any,hits:any[]){
  return hits.map(hit=>{
    let allowed=false;try{const u=new URL(hit.url);allowed=['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!/(?:^|\/)(?:help|developers?|docs|login|signin)(?:\/|$)/i.test(u.pathname);}catch{}
    const relevant=allowed&&relevantPersonText(person.name,person.companyName,[hit.title,hit.snippet].join('\n'));
    return {...hit,admitted:relevant,reason:relevant?'姓名和企业同时出现；正文仍需核实':'缺少姓名／企业关联或属于非资料入口'};
  });
}
export function personPageResult(person:any,page:any){
  const text=(page.blocks||[]).map((b:any)=>b.text).join('\n');
  const relevant=!['blocked','restricted','login_required','captcha','rate_limited'].includes(page.state)&&relevantPersonText(person.name,person.companyName,text);
  const social=/https?:\/\/(?:[^/]+\.)?(?:facebook|instagram|linkedin|threads|reddit|tiktok|xiaohongshu|x|twitter)\.(?:com|net|cn)\//i.test(page.url||'');
  const result={...page,relevant,sourceType:social?'social_body':'website_body',readAt:page.readAt||new Date().toISOString(),
    contentHash:personHash(text),notice:relevant?'已取得相关正文；姓名、任职及渠道仍分别核对':'已读取但未证明人物与企业关联，不进入模型分析'};
  return {...result,...extractPublicPerson(person,result),personLinks:observedPersonLinks(person,result)};
}
export async function readPersonPublic(person:any,url:string,options:{beforeRequest:()=>Promise<void>;maxImages?:number;browser?:boolean},read:(...args:any[])=>Promise<any>=readSocialPage){
  try{return personPageResult(person,await read(url,{companyId:person.companyId,browser:options.browser??true,maxImages:options.maxImages??0,maxNetworkRequests:32,beforeRequest:options.beforeRequest}));}
  catch(e){return {state:'restricted',url,relevant:false,blocks:[],images:[],reason:(e as Error).message.slice(0,500),readAt:new Date().toISOString(),notice:'本入口未取得正文；不引导整批登录，也不记为研究完成'};}
}
export function publicPersonUrls(result:any,seen:string[]){
  return result.filter((h:any)=>h.admitted&&!seen.includes(h.url)).slice(0,2).map((h:any)=>h.url);
}
