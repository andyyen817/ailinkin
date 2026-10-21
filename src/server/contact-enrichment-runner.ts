import 'server-only';
import {randomUUID} from 'node:crypto';
import {operatorKey,operatorUsage} from './operator-batch-policy';
import {executableEnrichmentLimits} from './contact-enrichment-policy';
import {enrichmentQuery,enrichmentCandidates} from './contact-enrichment-evidence';
import {nextTraceOperation} from './contact-trace-runner';
const operation=(kind:string,input:any)=>({id:randomUUID(),kind,...input,key:operatorKey(kind,input),state:'reserved',createdAt:new Date().toISOString(),stages:[]});
export function enrichmentPersonSummary(p:any){
  const owned=(p.emailCandidates||[]).find((c:any)=>c.value===p.email&&c.confirmed),others=(p.otherAccounts||[]).filter((a:any)=>a.confirmed);
  p.ownershipState=owned?'公开原文已对应本人':p.email?'供应商或公开候选，归属待核':'未取得个人邮箱';
  p.status=p.email?(owned?'归属已核实，邮箱待验':'工作邮箱候选'):others.length?'取得本人其他账号':p.otherAccounts?.length?'其他账号待核实':p.finderSkipped?'免费额度未覆盖':'本轮未取得联系方式';
  p.reason=[p.publicReason,p.emailReason,p.ownershipState].filter(Boolean).join('；');
}
export function nextEnrichmentOperation(batch:any){
  const receipts=batch.receipts,has=(kind:string,p?:any,url?:string)=>receipts.some((r:any)=>r.kind===kind&&(!p||r.personKey===p.personKey)&&(!url||r.url===url));
  if(batch.state==='checking'){
    for(const provider of ['prospeo','hunter'])if(!receipts.some((r:any)=>r.kind==='account'&&r.slot==='before'&&r.provider===provider))return operation('account',{provider,slot:'before'});
    if(!has('public_qualification'))return operation('public_qualification',{provider:'public'});
    batch.limits=executableEnrichmentLimits(batch);batch.state='confirm';return null;
  }
  if(batch.state!=='running')return null;
  if(batch.traceMethod==='trace_v2'&&batch.stage==='enrichment'){
    const op=nextTraceOperation(batch);for(const p of batch.people.filter((p:any)=>p.enrichmentComplete)){enrichmentPersonSummary(p);p.reason+='；'+p.traceReason;}return op;
  }
  if(batch.stage==='enrichment'){
    for(const [index,p] of batch.people.entries()){
      if(index<batch.limits.searches&&!has('public_search',p))return operation('public_search',{provider:'langsearch',personKey:p.personKey,companyId:p.companyId,query:enrichmentQuery(p)});
      const search=receipts.find((r:any)=>r.kind==='public_search'&&r.personKey===p.personKey&&r.state==='done');
      const pages:any[]=search?enrichmentCandidates(p,search.result?.results||[]):[];
      if(!pages.length&&p.domain){
        const root='https://'+p.domain+'/',home=receipts.find((r:any)=>r.kind==='public_page'&&r.personKey===p.personKey&&r.url===root&&r.state==='done'&&r.result?.state==='read');
        pages.push({url:root});
        const links=(home?.result.links||[]).filter((l:any)=>{try{return new URL(l.url).hostname.replace(/^www\./,'')===p.domain&&l.url!==root;}catch{return false;}});
        const named=(v:string)=>v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,''),follow=links.find((l:any)=>named(l.label||'').includes(named(p.name)))||links.find((l:any)=>/^(?:about(?: us)?|our team|team|management|leadership)$/i.test((l.label||'').trim()));
        if(follow)pages.push(follow);
      }
      if(p.enrichmentComplete&&pages.every(c=>has('public_page',p,c.url))){enrichmentPersonSummary(p);continue;}
      const used=operatorUsage([batch]);
      for(const candidate of pages)if(!has('public_page',p,candidate.url)&&used.publicPages<batch.limits.publicPages&&receipts.flatMap((r:any)=>r.stages||[]).filter((s:any)=>s.stage==='public_network_started').length+2<=batch.limits.network)
        return operation('public_page',{provider:'public',personKey:p.personKey,companyId:p.companyId,url:candidate.url});
      if(!p.publicReason)p.publicReason=search?pages.length?'公开网页已检查；归属以证据为准':'搜索未找到可读取的人物关联网页':'公开搜索未覆盖或来源不可用';
      if(index<batch.limits.finder&&!has('finder',p))return operation('finder',{provider:'prospeo',personKey:p.personKey,companyId:p.companyId});
      if(index>=batch.limits.finder){p.finderSkipped=true;p.emailReason='实际免费余额或每日次数未覆盖，未调用邮箱补查。';}
      p.enrichmentComplete=true;enrichmentPersonSummary(p);
    }
    batch.stage='verify';
  }
  return null;
}
