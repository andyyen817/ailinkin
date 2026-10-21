import {buyerPages,pageEvidenceId} from './buyer-site-pages.mjs';
export function evidencePackets(entity){
  return buyerPages(entity).flatMap(page=>{
    const text=page.content.slice(0,6000),id=pageEvidenceId(entity,page),units=[];
    for(let start=0;start<text.length;){
      let end=Math.min(start+900,text.length);
      const email=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(text.slice(start));
      if(email&&email.index===0){start+=email[0].length;continue;}
      if(email&&start+email.index<end)end=start+email.index;
      if(end<text.length){const boundary=text.lastIndexOf(' ',end);if(boundary>start+500)end=boundary;}
      if(end-start>=8)units.push({id,evidenceRef:id+':'+start,url:page.url,text:text.slice(start,end),readScope:page.readScope||'public_html_page'});start=end;
    }
    return units;
  });
}
export function materializeBuyerResult(entity,raw){
  if(!raw||raw.entityId!==entity.id)return null;
  const result=structuredClone(raw),q=result.qualification;
  if(!q||typeof q!=='object')return null;
  for(const key of ['direction','criticalUnknowns','conflicts','followUpQuestions']){
    if(q[key]!==undefined&&result[key]!==undefined&&JSON.stringify(q[key])!==JSON.stringify(result[key]))return null;
    if(q[key]===undefined&&result[key]!==undefined)q[key]=structuredClone(result[key]);
  }
  const units=new Map(evidencePackets(entity).map(p=>[p.evidenceRef,p]));
  for(const claim of [result.ownership,...['identity','market','buyer','cooperation'].map(k=>q[k])]){
    if(!claim||!Object.hasOwn(claim,'evidenceRef'))continue;
    const unit=units.get(claim.evidenceRef);
    if(claim.matched&&!unit)return null;
    claim.evidenceId=unit?.id||null;claim.quote=unit?.text||'';
  }
  return result;
}
export const evidenceContract=[
  '本轮使用evidenceRef选择证据。每个evidence/additionalEvidence都是一段已保存的官网原文。只引用当前entityId的evidenceRef，不自行拼接或改写quote；系统会从选中的片段还原原文。',
  'ownership选择包含企业品牌名及自我介绍、品牌页脚或运营归属的片段。仅运营公司的名字不能代替输入品牌的归属证据，新闻提及和单一门店照片不能证明官网归属。',
  '本次判断是否值得开发的潜在客户。身份、当地经营、买方业务及产品用途关系有依据才matched=true；并非验证已愿意购买、已下订单、已有预算或指定采购人。',
  'cooperation的explanation必须说明具体业务如何可能用到我方产品，并明确为待验证假设，不能把网站未说明的设备、痛点或采购意愿写成事实。',
  'criticalUnknowns只列无法判断身份、当地经营、目标买方业务、潜在合作用途的缺项。是否统一采购、现有供应商、换机计划、对IoT的意愿、预算和采购时间放followUpQuestions，不替代四项业务判断。若组织只是无法归属的单店或第三方代理，真实主体或合作角色不明仍必须保留关键未知。',
  '只有确实不存在上述关键缺项时criticalUnknowns=[]，不能因为希望找到客户而强行通过。否定或冲突原文保留conflicts，matched=false时不能编造证据。',
  '唯一输出结构：{"results":[{"entityId":"输入ID","siteKind":"buyer_site/reference/unrelated/unknown","ownership":{"matched":false,"evidenceRef":null,"explanation":"归属依据"},"qualification":{"identity":{"matched":false,"evidenceRef":null,"explanation":"身份依据"},"market":{"matched":false,"evidenceRef":null,"explanation":"当地经营依据"},"buyer":{"matched":false,"evidenceRef":null,"explanation":"目标组织业务依据"},"cooperation":{"matched":false,"evidenceRef":null,"explanation":"用途关系和待验证假设"},"direction":"buys_from_us/refers_orders/unclear","criticalUnknowns":[],"conflicts":[],"followUpQuestions":[]}}]}。direction、criticalUnknowns、conflicts和followUpQuestions都必须在qualification里面。',
  '输出前逐企业检查：输入ID一一对应；每个matched=true有本企业合法evidenceRef；ownership片段包含输入品牌名；采购沟通问题没有混入关键未知；不借用别家证据。'
].join('\n');
