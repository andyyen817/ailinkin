import {hash,host} from './core.mjs';
import {ProviderError} from './http.mjs';
export function contactPlan(group,website){
  if(!group?.ready||!group.searchSpecs?.length)throw new ProviderError('先完成当前买方方向检查，再查联系人','待核实');
  const directions=new Set(group.searchSpecs.map(s=>s.direction));
  if(directions.size!==1||![...directions].every(d=>['buys_from_us','refers_orders','operates_our_brand'].includes(d)))throw new ProviderError('联系人交易方向待核实','待核实');
  const titles=[...new Set((group.decisionRoles||[]).map(t=>String(t).trim()).filter(Boolean))];
  if(!titles.length||titles.length>20||titles.some(t=>t.length>120))throw new ProviderError('企业分析需补齐适合的决策岗位','待核实');
  if(group.searchSpecs.some(s=>s.language==='en')&&titles.some(t=>/[\p{Script=Han}]/u.test(t)))throw new ProviderError('海外联系人检索需使用分析生成的英文岗位，请更新企业分析','待核实');
  const body={q_organization_domains_list:[host(website)],person_titles:titles,page:1,per_page:5};
  return {body,key:hash(JSON.stringify([group.analysisVersion,group.semanticKey,body])),direction:[...directions][0]};
}
