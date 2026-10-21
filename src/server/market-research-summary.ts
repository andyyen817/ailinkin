import 'server-only';
import {createHash} from 'node:crypto';
import type {AnalysisRow} from './company-analysis-store';
import type {Campaign} from '@/domain/research';
import type {MarketSource,MarketReport} from '@/domain/market-research';
import {marketKey,targetMarkets} from '@/domain/target-markets';
import {AccessError} from './policy';
import {checkedQuality} from './company-reviewed-analysis';
export const marketDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function marketInputHash(row:AnalysisRow,market:string){return marketDigest([row.data.input,row.data.schemaVersion,row.data.report,marketKey(market)]);}
export function cachedMarketSnapshot(row:AnalysisRow,market:string,campaigns:Campaign[],now=new Date().toISOString()){
  if(!targetMarkets(row.data.input.market).some(m=>marketKey(m)===marketKey(market)))throw new AccessError('TARGET_MARKET_NOT_AVAILABLE',409);
  const related=campaigns.filter(c=>c.tenant_id===row.tenant_id&&marketKey(c.data.project.country)===marketKey(market)&&
    (c.data.project.buyerGroup?.analysisId===row.id||(c.data.project.buyerGroup?.supplier?.business===row.data.input.business&&c.data.project.buyerGroup?.supplier?.companyName===row.data.input.companyName)));
  const sources:MarketSource[]=row.data.sources.map(s=>({id:'enterprise-'+s.id,title:s.label,text:s.text,kind:'enterprise',market:'',retrievedAt:now,contentHash:marketDigest(s.text),links:[]}));
  const observed=new Map<string,MarketSource>(),companies=new Map<string,any>();
  for(const campaign of related){
    for(const e of campaign.data.sourcePipeline?.entities||[])for(const p of e.websitePages||[])if(p.content&&p.url){
      const key=marketDigest([p.url,p.content]);observed.set(key,{id:'website-'+key.slice(0,24),url:p.url,title:e.name||p.url,text:p.content.slice(0,40000),kind:e.ownership?.verified?'official':'search',
        market,retrievedAt:p.retrievedAt||now,contentHash:marketDigest(p.content.slice(0,40000)),links:(p.links||[]).map((l:any)=>typeof l==='string'?l:l.url).filter((u:any)=>/^https?:\/\//.test(u||'')).slice(0,100)});
    }
    for(const p of campaign.data.sourcePages||[])if(p.url&&(p.content||p.text||p.snippet)){
      const text=String(p.content||p.text||p.snippet).slice(0,40000),key=marketDigest([p.url,text]);
      if(!observed.has(key))observed.set(key,{id:'saved-'+key.slice(0,24),url:p.url,title:p.title||p.url,text,kind:'search',market,retrievedAt:p.retrievedAt||now,contentHash:marketDigest(text),links:[]});
    }
    for(const c of campaign.data.companies||[]){if(c.sourceOnly)continue;const key=c.assetId||c.apolloId||c.website||c.id;
      const old=companies.get(key);if(!old||c.qualification?.updatedAt>old.qualification?.updatedAt)companies.set(key,c);}
  }
  sources.push(...observed.values());
  const profiles=row.data.report?.profiles||[],buyers=profiles.map(p=>({text:p.label+'：'+p.why,kind:'hypothesis' as const,
    references:p.factIds.flatMap(id=>{const f=row.data.report!.facts.find(f=>f.id===id);return f&&f.quote.length>=8?[{sourceId:'enterprise-'+f.sourceId,quote:f.quote}]:[];})}));
  const localReport:MarketReport={summary:`已复用企业资料与${market}相关搜索；客户方向属于待验证合作假设。`,buyers,
    channels:buyers.filter((_,i)=>/经销|分销|进口|代理|渠道|distributor|importer|channel/i.test(profiles[i].role+' '+profiles[i].label)),competitors:[],competitiveness:[],
    unknowns:['竞争对手及当地产品／服务要求尚需有出处的资料','市场客户总量暂无法可靠估计；不能用网页数或门店数代替采购主体数'],nextActions:['先覆盖各优先买家群体，再按新增适配企业与预算继续搜索']};
  const list=[...companies.values()],qualified=list.filter(c=>c.qualification?.status==='qualified'&&c.qualification?.identityVerified&&c.qualification?.marketVerified&&c.qualification?.buyerVerified).length;
  const groups=(row.data.groups||[]).filter(g=>marketKey(g.market)===marketKey(market)).map(g=>{
    const runs=related.filter(c=>c.data.project.buyerGroup?.semanticKey===g.semanticKey),batches=runs.flatMap(c=>c.data.batches||[]);
    return {key:g.semanticKey,label:g.label,queries:g.keywords,ready:g.ready,attemptedBatches:batches.length,
      completedBatches:batches.filter((b:any)=>b.status==='已完成').length,status:batches.length?'已有部分查询记录':'尚未搜索'};
  });
  return {market,inputHash:marketInputHash(row,market),companyId:row.id,sources,report:localReport,reportOrigin:'saved_enterprise_analysis',
    planContext:checkedQuality(row.data.report,row.data.input,row.data.sources)?.draft.buyers||[],
    counts:{candidateOrganizations:list.length,qualifiedOrganizations:qualified,pendingOrganizations:list.filter(c=>!['qualified','unfit'].includes(c.qualification?.status)).length,
      unfitOrganizations:list.filter(c=>c.qualification?.status==='unfit').length,marketTotal:null,databaseMatches:null},
    groups,companies:list.map(c=>({id:c.id,name:c.name,website:c.website,status:c.qualification?.status||'pending'})),
    relatedCampaignIds:related.map(c=>c.id),sourcesReused:observed.size,updatedAt:now,state:'partial',requests:[],externalRequests:0,sent:0};
}
