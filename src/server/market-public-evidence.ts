import 'server-only';
import {randomUUID} from 'node:crypto';
import {loadPublicPage} from '../../scripts/research/public-page.mjs';
import {pinnedGet} from '../../scripts/research/public-page-client.mjs';
import {ProviderError} from '../../scripts/research/http.mjs';
import {marketDigest} from './market-research-summary';
import {rankMarketSources} from './market-model-context';
import {marketSearchPlans} from './market-search-plan';
const excluded=/\b(?:facebook|instagram|linkedin|threads|tiktok|reddit|wikipedia)\.(?:com|org|net)|\/(?:search|login|signin)(?:\/|\?|$)/i;
export function reviewKnownDnsFailures(snapshot:any){
  let changed=false;
  for(const item of snapshot.pageReads||[]){
    if(item.status!=='unknown'||typeof item.url!=='string'||!Array.isArray(item.network)||!/^getaddrinfo ENOTFOUND /.test(item.reason||''))continue;
    let hostname:string;try{hostname=new URL(item.url).hostname;}catch{continue;}
    if(item.status==='unknown'&&item.reason==='getaddrinfo ENOTFOUND '+hostname&&item.network.length===1&&
      item.network[0].url===new URL('/robots.txt',item.url).href&&item.network[0].state==='unknown'&&!item.network[0].status){
      item.resolutionReview={originalStatus:item.status,originalNetworkState:item.network[0].state,basis:'Native getaddrinfo ENOTFOUND before HTTP dispatch',reviewedAt:new Date().toISOString()};
      item.status='failed';item.network[0].state='failed';item.network[0].errorCode='ENOTFOUND';item.finishedAt=new Date().toISOString();changed=true;
    }
  }
  return changed;
}
export async function readMarketPublicEvidence(snapshot:any,scope:any,save:()=>Promise<void>,
  guard?:((item:any)=>Promise<any>),get:typeof pinnedGet=pinnedGet){
  if(!scope.publicPages)return;
  if(scope.sharedBudget&&!guard)throw Error('SHARED_BUDGET_GUARD_REQUIRED');
  const entries=snapshot.pageReads||=[],limit=scope.publicPages.maxPages;
  // A native DNS failure happens before HTTP dispatch. Keep the original observation when resolving it.
  if(reviewKnownDnsFailures(snapshot))await save();
  if(entries.some((e:any)=>['pending','unknown'].includes(e.status)))throw Error('MARKET_PUBLIC_REQUEST_UNKNOWN');
  const seen=new Set(entries.map((e:any)=>e.url));
  const plans=scope.searchPlans?marketSearchPlans(scope):null;
  const currentIds=new Set((snapshot.searches||[]).filter((s:any)=>s.scopeId===scope.id&&s.state==='done'&&(!plans?(!scope.queries?.length||scope.queries.includes(s.query)):plans.some((p:any)=>p.key===s.planKey))).flatMap((s:any)=>s.sourceIds||[]));
  const candidates=snapshot.sources.filter((s:any)=>s.url&&s.kind==='search'&&s.evidenceType!=='body'&&!excluded.test(s.url)&&
    (!scope.searchPlans&&currentIds.size===0||currentIds.has(s.id)));
  const usable=candidates.filter((source:any)=>{
    if(scope.publicPages.purpose!=='organization_evidence')return true;
    const context=source.title+' '+source.url;
    const reference=/\bessay\b|can i drink tap water|\/destinations\/|\/(?:industry-report|reports|examples)\/|\bmarket\b.{0,80}\b(?:report|size|outlook|forecast|share)\b|市场.{0,30}(报告|规模|预测)/i.test(context);
    if(reference)(snapshot.publicReadSelection||=[]).push({sourceId:source.id,url:source.url,status:'reference_only',reason:'企业补证不读取泛市场报告、旅游或作文页；原始材料继续保留'});
    return !reference;
  });
  const observed=(scope.publicPages.observedUrls||[]).map((url:string)=>{
    const canonical=(value:string)=>{try{return new URL(value.replace(/[),.;，。]+$/,'' )).href;}catch{return null;}};
    if(!snapshot.sources.some((s:any)=>[s.url,...s.links||[],...s.text?.match(/https?:\/\/[^\s<>"'`]+/g)||[]].some((u:string)=>typeof u==='string'&&canonical(u)===canonical(url))))throw Error('MARKET_PUBLIC_URL_NOT_OBSERVED');
    return {id:'observed-'+marketDigest(url).slice(0,24),url,title:'已观察的企业网站链接',depth:0};
  });
  const queue=observed.length?observed:rankMarketSources(snapshot.market,usable,true,scope.queries).sources.map((s:any)=>({...s,depth:0}));
  for(const source of queue){
    if(entries.filter((e:any)=>e.scopeId===scope.id).length>=limit)break;
    const prior=entries.filter((e:any)=>e.url===source.url),retry=scope.publicPages.retryFailedObservedUrls?.includes(source.url)&&observed.some((s:{url:string})=>s.url===source.url)&&prior.length===1&&prior[0].status==='failed';
    if(seen.has(source.url)&&!retry||snapshot.sources.some((s:any)=>s.url===source.url&&s.evidenceType==='body'))continue;
    if(Date.now()+20000>=Date.parse(scope.expiresAt))throw Error('MARKET_SCOPE_EXPIRED');
    const item:any={id:randomUUID(),url:source.url,scopeId:scope.id,status:'pending',network:[],startedAt:new Date().toISOString()};
    await guard?.({service:'social_public',requestKey:'market-page-'+item.id,reservedCost:0});
    entries.push(item);snapshot.pageReads=entries;seen.add(source.url);await save();
    const boundedGet=async(url:string,options:any={})=>{
      let current=url;
      for(let n=0;n<6;n++){
        if(scope.publicPages.preferHttps&&observed.some((s:{url:string})=>s.url===source.url)){const target=new URL(current);if(target.protocol==='http:'){target.protocol='https:';current=target.href;}}
        if(item.network.length>=scope.publicPages.maxNetworkRequestsPerPage||Date.now()>=Date.parse(scope.expiresAt))throw new ProviderError('本页网络或时间额度已到','访问受限／未接入');
        const attempt:any={url:current,state:'pending'};item.network.push(attempt);await save();
        try{const r:any=await get(current,{...options,...scope.publicPages.timeoutMs?{timeoutMs:scope.publicPages.timeoutMs}:{}});attempt.state='done';attempt.status=r.status;attempt.contentHash=marketDigest(r.text);await save();
          if([301,302,303,307,308].includes(r.status)){if(!r.headers.location)throw new ProviderError('重定向缺少地址','待核实');current=new URL(r.headers.location,current).href;continue;}
          return {...r,networkRequests:n+1};
        }catch(e){const dns=(e as NodeJS.ErrnoException).code==='ENOTFOUND'&&(e as NodeJS.ErrnoException).syscall==='getaddrinfo';
          attempt.state=e instanceof ProviderError||dns?'failed':'unknown';if(dns)attempt.errorCode='ENOTFOUND';await save();
          if(dns)throw new ProviderError('官网域名无法解析；尚未连接到网站','待核实');throw e;}
      }
      throw new ProviderError('重定向次数上限已到','待核实');
    };
    try{const page=await loadPublicPage(source.url,boundedGet as any);item.status='done';item.observedUrl=page.url;item.characters=page.content.length;
      snapshot.sources.push({id:'body-'+marketDigest([page.url,page.content]).slice(0,24),url:page.url,title:source.title,
        text:page.content,kind:'search',evidenceType:'body',market:snapshot.market,retrievedAt:new Date().toISOString(),contentHash:marketDigest(page.content),links:page.links});
      const directory=/submitted this listing|this listing belong|directory listing/i.test(page.content);
      const terms=[...new Set<string>(((scope.queries||[]) as string[]).join(' ').toLowerCase().match(/[a-z+]{4,}/g)||[])].filter(w=>!['water','systems','system','supplier','distributor','official','website','commercial','service','installation'].includes(w));
      const related=(link:{url:string;label:string})=>{const u=new URL(link.url),label=link.label+' '+u.pathname,same=u.hostname===new URL(page.url).hostname;
        if(directory)return !same&&(/official|website/i.test(link.label)||link.label.includes(u.hostname))?10:0;
        if(!same)return /official|website/i.test(link.label)?2:0;
        return terms.filter(w=>label.toLowerCase().includes(w)).length*4+Number(/contact|dealer|distribut|about/i.test(label))*2;};
      const links=(page.linkDetails||[]) as Array<{url:string;label:string}>;
      if(source.depth<2)for(const link of links.filter(l=>related(l)>0).sort((a,b)=>related(b)-related(a)).slice(0,2)){
        if(excluded.test(link.url)||seen.has(link.url)||queue.some((s:any)=>s.url===link.url))continue;
        queue.push({...source,id:'linked-'+marketDigest(link.url).slice(0,24),url:link.url,title:link.label,depth:source.depth+1});
      }
    }catch(e){item.status=e instanceof ProviderError?'failed':'unknown';item.reason=(e as Error).message;
      await save();if(item.status==='unknown')throw Error('MARKET_PUBLIC_REQUEST_UNKNOWN');
    }
    item.finishedAt=new Date().toISOString();await save();
  }
}
