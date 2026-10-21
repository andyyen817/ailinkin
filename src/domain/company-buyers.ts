import {z} from 'zod';
import {normalText, type CheckedStatement} from './company-evidence';
import {queryMarketAllowed} from './target-markets';
const line=z.string().trim().min(1).max(500);
const list=z.array(line).max(12);
export const buyerDraftSchema=z.object({
  id:line,label:line,application:line,
  role:z.enum(['brand','manufacturer','distributor','importer','operator','institution','business']),
  direction:z.enum(['buys_from_us','refers_orders','sells_to_us','unclear']),
  use:z.enum(['integrates','resells','uses','operates','refers','supplies_us']).describe('与我方提供内容的关系：uses=使用我方设备/产品/服务；operates仅指运营我方提供的品牌或加盟体系，不表示对方经营自己的门店；integrates=集成我方部件，resells=转售我方产品，refers=引荐订单，supplies_us=供应给我方。'),
  need:line,offeringFactIds:z.array(line).min(1).max(12),dependencyFactIds:list,
  priority:z.enum(['优先','备选','待补资料']),decisionRoles:list,unknowns:list,
  queries:z.array(z.object({business:line.describe('Executable search phrase describing BUYER business. If language=en, write this field entirely in English, e.g. lighting components, water treatment equipment. Never put a Chinese explanation here.'),roleTerm:line,language:z.enum(['zh','en']),
    market:line,verify:z.array(line).min(1).max(8),avoidRoles:list}).extend({roleTerm:line.optional().describe('不要输出；系统根据客户role与language自动生成。历史数据若提供则必须一致。')}).strict()).min(1).max(6),
}).strict();
export type BuyerDraft=z.infer<typeof buyerDraftSchema>;
const roles:Record<BuyerDraft['role'],{zh:string;en:string}>= {
  brand:{zh:'品牌企业',en:'brand'},manufacturer:{zh:'制造企业',en:'manufacturer'},
  distributor:{zh:'经销商',en:'distributor'},importer:{zh:'进口商',en:'importer'},
  operator:{zh:'运营企业',en:'operator'},institution:{zh:'机构',en:'institution'},business:{zh:'企业',en:'company'},
};
const seller=/寻找客户|招商加盟|代加工服务|\b(franchise opportunities|become a franchisee|oem services)\b/i;
export function checkBuyer(buyer:BuyerDraft, statements:CheckedStatement[], market:string, intent='') {
  const reasons:string[]=[], warnings:string[]=[], facts=new Map(statements.map(s=>[s.id,s]));
  const evidence=buyer.offeringFactIds.map(id=>facts.get(id));
  if(evidence.some(s=>!s || !['business','ability'].includes(s.kind))) reasons.push('我方提供内容缺少有效企业依据');
  if(buyer.dependencyFactIds.some(id=>!facts.has(id) || !['business','ability'].includes(facts.get(id)!.kind))) reasons.push('依赖的企业能力尚未得到支持');
  if(!['buys_from_us','refers_orders'].includes(buyer.direction)) reasons.push('尚未说明对方采购我方或带来订单的路径');
  if(buyer.use==='supplies_us' || (buyer.direction==='refers_orders') !== (buyer.use==='refers')) reasons.push('合作用途与订单方向不一致');
  if(buyer.priority==='待补资料') reasons.push('需要补充关键企业信息');
  const ownNetwork=/自有|自家|本公司|our own/i.test(intent) && /品牌|brand/i.test(intent) && /加盟|franchis/i.test(intent);
  if(ownNetwork && (buyer.use!=='operates' || buyer.role!=='operator')) reasons.push('自有品牌加盟拓展需要实际运营合作方；品牌所有者身份不能证明运营我方品牌');
  const evidenceUnknown=statements.some(s=>/认证|资质|证书/.test(s.context) && /(?:没有|未).{0,3}提供.{0,8}(证明|资料|信息|说明)/.test(s.context));
  const buyerClaims=JSON.stringify([buyer.need,buyer.unknowns,buyer.queries.map(q=>q.verify)]);
  if(evidenceUnknown && /(?:无|没有|不具备).{0,5}(认证|资质|证书)/.test(buyerClaims)) reasons.push('尚未提供资质证明，不能据此认定没有资质');
  const originAssumption=/中国供应商|从中国采购|中国制造|Chinese suppliers?|from China/i;
  const originSupported=statements.some(s=>['business','ability'].includes(s.kind) && /(?:位于|来自|我们是).{0,4}中国|中国企业|中国公司/.test(s.context));
  const cleanUnknowns=buyer.unknowns.map(s=>{
    if(!originSupported && originAssumption.test(s)) {
      warnings.push('未提供我方所在地，已移除预设中国来源；需核实供应商地域要求');
      return '核实我方所在地及买方对供应商地域的要求';
    } return s;
  });
  if(!originSupported && originAssumption.test(JSON.stringify([buyer.need,buyer.application,buyer.label]))) reasons.push('合作假设预设了尚无依据的我方所在地');
  const validQueries: Array<BuyerDraft['queries'][number]&{text:string}>=[];
  for(const query of buyer.queries) {
    const roleTerm=roles[buyer.role][query.language];
    if(!queryMarketAllowed(query.market,market)) {reasons.push('搜索地区与企业目标不一致，每条查询只使用一个已选市场');continue;}
    if(query.roleTerm!==undefined && normalText(query.roleTerm)!==normalText(roleTerm)) {reasons.push('搜索角色与买方角色不一致');continue;}
    if(seller.test(query.business)) {reasons.push('搜索词偏向供应或招商，请明确采购或运营组织');continue;}
    if(buyer.role==='operator' && (ownNetwork || buyer.use!=='uses') && /加盟|\bfranchise\b/i.test(query.business) && !/多品牌|multi.brand/i.test(query.business)) {
      reasons.push('加盟词未限定运营组织，容易返回品牌招商方');continue;
    }
    if(query.language==='en' && /[\u4e00-\u9fff]/.test(query.business)) {reasons.push('海外搜索业务词语言不一致');continue;}
    if(['uses','operates'].includes(buyer.use) && (query.language==='en' ? /\b(equipment|systems?|services?)\b/i.test(query.business) : /服务.{0,4}采购/.test(query.business))) {
      warnings.push('已移除以设备或服务采购描述终端用户的查询；需要明确买方实际经营组织');continue;
    }
    let business=query.business.trim();
    if(buyer.use==='uses' && /\bfranchise\s+chain\b|加盟连锁|连锁加盟/i.test(business)) {
      business=business.replace(/\bfranchise\s+chain\b/gi,'chain').replace(/加盟连锁|连锁加盟/g,'连锁');
      warnings.push('设备使用方按实际连锁业务搜索，加盟模式在客户核实中确认，不作为每条查询的强制词');
    }
    if(buyer.use==='uses' && query.language==='zh') business=business.replace(/((?:使用|应用)(?:企业|单位|机构)).*$/,'$1');
    for(let pass=0;pass<2;pass++) for(const suffix of [query.market,roleTerm]) {
      if(normalText(business).endsWith(' '+normalText(suffix))) business=business.slice(0,-suffix.length).trim();
    }
    const localArea=evidence.find(s=>s && s.kind==='ability' && s.region && /上门|现场服务/.test(s.context))?.region.replace(/及周边|and nearby/gi,'').trim();
    const text=[localArea,business,query.language==='zh' && business.endsWith(roleTerm)?'':roleTerm,query.market].filter(Boolean).join(' ');
    if(text.length>800) {reasons.push('搜索表达过长');continue;}
    validQueries.push({...query,business,roleTerm,text});
  }
  if(!validQueries.length) reasons.push('没有通过检查的买方查询');
  const offering=evidence.filter(Boolean).map(s=>s!.context).join('；');
  return {id:buyer.id,ready:reasons.length===0,reasons:[...new Set(reasons)],warnings:[...new Set(warnings)],priorityAdjustment:null as string|null,queries:validQueries,
    profile:{id:buyer.id,label:buyer.label,role:roles[buyer.role].zh,application:buyer.application,
      why:`企业资料原文：${offering.slice(0,350)}。待验证的合作假设：${buyer.need.slice(0,300)}`,
      factIds:buyer.offeringFactIds.filter(id=>facts.has(id)),unknowns:[...new Set(cleanUnknowns)],
      priority:buyer.priority,decisionRoles:buyer.decisionRoles,queryTerms:validQueries.map(q=>q.text)},
    transaction:{direction:buyer.direction,use:buyer.use,need:buyer.need}};
}
