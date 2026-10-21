import {hash} from './core.mjs';
export const locatorPlanIds=['buyer-name-v2','buyer-alias-v2','buyer-market-v2','apollo-name-v1','buyer-local-site-v1','buyer-exact-market-v1'];
export const normalizeName=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const has=(text,name)=>(' '+normalizeName(text)+' ').includes(' '+normalizeName(name)+' ');
const relations=['same_entity','brand','parent','local_operator','unknown'];
export function checkedIdentityHints(entity,pages){
  const evidence=(hint,term)=>{
    const p=pages.find(p=>p.id===hint.sourceId),q=hint.quote;
    return p&&typeof q==='string'&&q.length>=4&&(p.title+'\n'+p.text.slice(0,900)).includes(q)&&has(q,entity.name)&&has(q,term);
  };
  const aliases=(entity.aliases||[]).slice(0,5).flatMap(a=>{
    if(typeof a.name!=='string'||!a.name.trim()||a.name.length>200||!relations.includes(a.relationship)||!evidence(a,a.name))return [];
    const p=pages.find(p=>p.id===a.sourceId);
    return [{name:a.name.trim(),relationship:a.relationship,sourceId:p.id,url:p.url,quote:a.quote,status:'关系待核实'}];
  });
  const businessTerms=(entity.businessTerms||[]).slice(0,3).flatMap(b=>{
    if(typeof b.term!=='string'||!b.term.trim()||b.term.length>60||!evidence(b,b.term))return [];
    const p=pages.find(p=>p.id===b.sourceId);
    return [{term:b.term.trim(),sourceId:p.id,url:p.url,quote:b.quote}];
  });
  return {aliases,businessTerms};
}
export function queryNames(entity){
  return [...new Set([entity.name,...(entity.aliases||[]).filter(a=>a.quote&&has(a.quote,entity.name)&&has(a.quote,a.name)&&relations.includes(a.relationship)).map(a=>a.name)])];
}
export function matchesEntityText(entity,text){
  return queryNames(entity).some(n=>n&&has(text,n)); // Retrieval only; no identity merge or ownership approval.
}
export function locatorPlans(entity,project){
  const market=project.buyerGroup?.searchSpecs?.[0]?.market||project.country;
  const term=(entity.businessTerms||[]).find(b=>b.quote&&has(b.quote,entity.name)&&has(b.quote,b.term))?.term;
  const focused=entity.name+(term&&!has(entity.name,term)?' '+term:'');
  const list=[{id:'buyer-name-v2',provider:'langsearch',purpose:'official_resolution',query:focused,
    family:'brand-business',reason:'先以已发现名称和有依据业务词定位品牌网站，不默认加入国家'}];
  const alias=queryNames(entity).find(n=>normalizeName(n)!==normalizeName(entity.name));
  if(alias)list.push({id:'buyer-alias-v2',provider:'langsearch',purpose:'official_resolution',query:alias,
    family:'evidenced-alias',reason:'参考资料明示相关名称，关系仍待核实，不自动合并采购主体'});
  if(market)list.push({id:'buyer-market-v2',provider:'langsearch',purpose:'local_operator',query:focused+' '+market,
    family:'local-operator',reason:'专门查目标地区运营主体；品牌全球官网不能证明当地经营'});
  const local=/菲律宾|^Philippines$/i.test(market)?{name:'Philippines',domains:['com.ph']}:/印尼|印度尼西亚|^Indonesia$/i.test(market)?{name:'Indonesia',domains:['co.id']}:null;
  if(local)list.push({id:'buyer-exact-market-v1',provider:'langsearch',purpose:'official_resolution',query:'"'+entity.name.replace(/"/g,' ')+'" '+local.name+' company website',
    family:'exact-name-market',reason:'明确品牌名称及经营地区，结果仍须读取官网核实；不以国家后缀限制全球域名'});
  if(local)list.push({id:'buyer-local-site-v1',provider:'langsearch',purpose:'local_operator',query:entity.name+' '+local.name,includeDomains:local.domains,
    family:'local-domain-comparison',reason:'有限地区域名对照，仍需核实身份及实际经营，未覆盖全球域名企业'});
  list.push({id:'apollo-name-v1',provider:'apollo',purpose:'organization_resolution',query:entity.name,
    family:'organization-name',reason:'按名称查组织，不按总部国家过滤；返回企业和网站均待核实'});
  return list.map(p=>({...p,key:hash(JSON.stringify([p.provider,p.purpose,p.query]))}));
}
export function selectLocatorPlan(entity,project,id='buyer-name-v2'){
  const plan=locatorPlans(entity,project).find(p=>p.id===id);
  if(!plan)throw Error('LOCATOR_PLAN_NOT_AVAILABLE');
  return plan;
}
export function locatorComparison(entity){
  return [...(entity.resolutionHistory||[]),...(entity.resolution?[entity.resolution]:[])].map(r=>({
    query:r.query,provider:r.provider||'langsearch',purpose:r.purpose||'legacy_resolution',plan:r.plan||'legacy',
    returned:r.audit?.returned??r.hits?.length??0,named:r.audit?.named??0,candidates:r.audit?.candidates??0,
    saved:r.fromSavedSource===true,status:r.status,completedAt:r.completedAt,
    ownershipVerified:entity.ownership?.verified===true&&r.hits?.some(h=>h.url===entity.ownership.url)||false
  }));
}
