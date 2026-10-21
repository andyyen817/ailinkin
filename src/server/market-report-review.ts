import {checkedMarketReport,marketClaim,type MarketSource} from '@/domain/market-research';
import {marketKey} from '@/domain/target-markets';
import {assertMarketModelData} from '@/domain/market-model-output';
export const MARKET_REVIEW_POLICY='market-evidence-v3-addresses';
export function reviewMarketReport(raw:any,sources:MarketSource[],market?:string){
  assertMarketModelData(raw);
  const report=structuredClone(raw),rejected:any[]=[];
  function temporal(value:any){
    if(!value||typeof value!=='object')return;
    if(value.kind==='fact'&&Array.isArray(value.references)&&value.references.some((r:any)=>/\b(?:will|planned|proposed|expected to|intends to)\b|计划|拟建|将设|将提供/i.test(r.quote))&&!/未来|计划|将|拟|planned|will/i.test(value.text)){
      rejected.push({section:'claims',index:rejected.length,original:structuredClone(value),reason:'MARKET_FUTURE_NOT_CURRENT'});
      value.kind='unknown';value.text='来源描述的是未来计划；当前是否已经实施未知。';
    }
    for(const child of Object.values(value))temporal(child);
  }
  temporal(report);
  function check(section:string,item:any,index:number){
    try{
      if(section==='buyers'||section==='channels'){
        const claim=marketClaim.parse(item);
        for(const ref of claim.references)if(!sources.some(s=>s.id===ref.sourceId&&s.text.includes(ref.quote)))throw Error('MARKET_REFERENCE_INVALID');
      }else {
        if(market&&['competitors','searchRecommendations'].includes(section)&&marketKey(item.market)!==marketKey(market))throw Error('REPORT_MARKET_MISMATCH');
        checkedMarketReport({summary:report.summary,buyers:[],channels:[],competitors:[],competitiveness:[],unknowns:[],nextActions:[],[section]:[item]},sources);
      }
      return true;
    }catch(e){rejected.push({section,index,original:structuredClone(item),reason:(e as Error).message});return false;}
  }
  for(const section of ['buyers','channels','competitors','competitiveness']){
    if(!Array.isArray(report[section]))throw Error('MARKET_REPORT_STRUCTURE_INVALID');
    report[section]=report[section].filter((item:any,index:number)=>check(section,item,index));
  }
  for(const section of ['offerings','usps','entryConditions','searchRecommendations']){
    if(report[section]===undefined)continue;
    if(!Array.isArray(report[section]))throw Error('MARKET_REPORT_STRUCTURE_INVALID');
    report[section]=report[section].filter((item:any,index:number)=>check(section,item,index));
  }
  return {report:checkedMarketReport(report,sources),review:{partial:rejected.length>0,rejected,
    notice:rejected.length?'部分模型建议未通过原有依据检查；未作为已核实结论，原始内容及原因已保存。':'本次结构及引用检查通过，事实含义和市场覆盖仍需核实。'}};
}
