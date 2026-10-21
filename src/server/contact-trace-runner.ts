import 'server-only';
import {randomUUID} from 'node:crypto';
import {operatorKey,operatorUsage} from './operator-batch-policy';
import {traceSearchQueries,traceFrontier} from './contact-trace-frontier';
const operation=(kind:string,input:any)=>({id:randomUUID(),kind,...input,key:operatorKey(kind,input),state:'reserved',createdAt:new Date().toISOString(),stages:[]});
export function nextTraceOperation(batch:any){
  const recent=batch.receipts.filter((r:any)=>r.kind==='public_search'&&r.state==='done'&&!r.reusedFrom&&!r.query.includes(' OR ')&&r.result?.results?.length).slice(-4);
  const unrelated=(r:any)=>{const p=batch.people.find((p:any)=>p.personKey===r.personKey);return p&&!r.result.results.some((v:any)=>[p.name,...p.traceAliases||[]].some((n:string)=>{const norm=(s:string)=>String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');return norm([v.title,v.snippet].join(' ')).includes(norm(n));}));};
  if(!batch.disabledProviders?.langsearch&&recent.length===4&&new Set(recent.map((r:any)=>r.personKey)).size>=2&&recent.every(unrelated)){
    const reason='连续两位人物的四次简洁检索均未返回目标姓名，相关性不足，停用该来源；官网与已保存公开外链继续，不重发旧查询。';
    (batch.disabledProviders||={}).langsearch=reason;batch.publicSearchQuality={state:'stopped_low_relevance',receiptIds:recent.map((r:any)=>r.id),at:new Date().toISOString(),reason};
    batch.events.push({at:new Date().toISOString(),message:reason});
  }
  const has=(kind:string,p:any,field:string,value:string)=>batch.receipts.some((r:any)=>r.kind===kind&&r.personKey===p.personKey&&r[field]===value);
  for(const [index,p] of batch.people.entries()){
    if(p.enrichmentComplete)continue;
    for(const [slot,query] of traceSearchQueries(p).entries()){
      const tracePath=slot?'职业活动及PDF':'其他平台公开账号';
      if(index*2+slot<batch.limits.searches&&!has('public_search',p,'tracePath',tracePath)&&!has('public_search',p,'query',query))return operation('public_search',{provider:'langsearch',personKey:p.personKey,companyId:p.companyId,query,tracePath});
    }
    const used=operatorUsage([batch]),attempts=batch.receipts.filter((r:any)=>r.kind==='public_page'&&r.personKey===p.personKey).length;
    const queue=traceFrontier(p,batch.receipts);
    if(attempts<4&&used.publicPages<batch.limits.publicPages&&used.network+2<=batch.limits.network){
      for(const candidate of queue)if(!has('public_page',p,'url',candidate.url))return operation('public_page',{provider:'public',personKey:p.personKey,companyId:p.companyId,url:candidate.url,traceVia:candidate.via,parentUrl:candidate.parentUrl});
    }
    p.enrichmentComplete=true;
    p.publicReason='公开线索检查已结束；'+(p.publicChecks?.some((c:any)=>c.state==='read')?'已保存可读正文和归属证据。':'未取得可确认归属的公开正文。');
    p.traceReason=attempts>=4?'每人已达到4条公开页面检查上限，继续下一位。':used.publicPages>=batch.limits.publicPages?'本轮页面额度已覆盖到上限，保留其余线索。':used.network+2>batch.limits.network?'网页HTTP余量不足，未继续请求。':'未发现更多符合范围且未查过的公开线索。';
    p.emailReason=p.email?'保留已保存的邮箱候选；旧地址不重复补查或验证。':'公开资料未取得工作邮箱；本轮未调用邮箱补查。';
  }
  batch.stage='verify';return null;
}
