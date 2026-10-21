import {createHash} from 'node:crypto';
export function marketSourcesKey(sources:any[]){
 const rows=sources.map(s=>[s.id,s.url||'',s.title||'',s.text,s.kind,s.market||'',s.contentHash||'',JSON.stringify([...(s.links||[])].sort())]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
export function savedMarketResponse(requests:any[],body:any,market:string,sources:any[],scopeId:string){
 const key=marketSourcesKey(sources);
 return requests.findLast(r=>{
  if(r.service!=='ai'||r.status!=='done'||r.scopeId!==scopeId||r.requestBody?.model!==body.model||
    r.requestBody?.messages?.[0]?.content!==body.messages[0].content||r.response?.choices?.[0]?.finish_reason!=='stop')return false;
  try{const payload=JSON.parse(r.requestBody.messages.at(-1).content);return payload.market===market&&marketSourcesKey(payload.sources)===key;}catch{return false;}
 });
}
