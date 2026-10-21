import {checkedOutreachDraft,draftDependencyHash} from './outreach';
export function draftFacts(entity:any){
  const buyer=entity.ownership?.result?.qualification?.buyer;
  const all=(entity.websitePages||[]).filter((p:any)=>p.content&&buyer?.matched&&p.content.includes(buyer.quote));
  const name=entity.name.split(/\s/)[0].toLowerCase();
  for(const p of all){
    const sentences=p.content.split(/(?<=[.!?])\s+/).filter((s:string)=>!/[\p{Script=Han}]/u.test(s));
    for(let sentence of sentences){
      if(!sentence.toLowerCase().includes(name))continue;
      if(sentence.split(/\s+/).length>40){const pos=sentence.toLowerCase().lastIndexOf(name);sentence=sentence.slice(pos);}
      if(sentence.split(/\s+/).length<8||sentence.split(/\s+/).length>36||/©|copyright|loading|subscribe|\bMENU\b|\bCAREER CENTER\b|previous|next slide|as picture/i.test(sentence))continue;
      return {id:entity.id+':'+draftDependencyHash(p.url).slice(0,12),url:p.url,quote:sentence.trim(),retrievedAt:p.retrievedAt};
    }
  }
  throw Error('SHORT_ENGLISH_OFFICIAL_FACT_REQUIRED');
}
export function prepareContactDraft(entity:any,group:any,contactPackage:any){
  if(!entity.ownership?.verified)throw Error('OFFICIAL_IDENTITY_REQUIRED');
  const source=draftFacts(entity),business=group.supplier?.business||'';
  if(!/RO/i.test(business)||!/iot/i.test(business)||!/大通量/.test(business)||!/滤芯/.test(business))throw Error('SUPPLIER_FEATURES_REQUIRE_REVIEW');
  const first=`Hello ${entity.name} team,\n\nI noticed this on your website: “${source.quote}”\n\nWe develop commercial RO water purification systems for chain outlets, with high-flow operation, IoT features and convenient filter replacement. These are our product capabilities; specifications and local service arrangements would need to be reviewed together.\n\nI am exploring whether this could be relevant to water treatment for your beverage operations. I do not know your current equipment, water requirements or purchasing plans, and would like to understand your setup before suggesting a solution.\n\nWho is responsible for water treatment equipment across your outlets, and is selection handled centrally or locally?\n\nBest regards,\n[Your name]\n[Company name]`;
  const context={entityId:entity.id,source,analysisId:group.analysisId,analysisVersion:group.analysisVersion,
    supplierFacts:group.supplier.facts,contactBasis:contactPackage.basisHash,sender:'missing'};
  const draft=checkedOutreachDraft({subjects:[`Water treatment equipment at ${entity.name}`,`A question for ${entity.name}'s operations team`,`${entity.name}: outlet water treatment contact`],first,
    followups:[`Hello ${entity.name} team,\n\nI wanted to follow up on who manages water treatment equipment across your outlets. If another team handles this, could you point me to the appropriate company contact?\n\nBest regards,\n[Your name]`,
      `Hello ${entity.name} team,\n\nThis is my final follow-up about the team responsible for outlet water treatment. If this is not relevant, please let me know and I will close the enquiry.\n\nBest regards,\n[Your name]`],
    references:[{text:source.quote,sourceId:source.id,quote:source.quote}]},[source],context);
  return {...draft,source,context,method:'已核实AI企业事实＋本地规则编排；本轮未调用模型',sendReady:false,
    blockers:['真实发件企业、邮箱和署名未补齐','具体收件人及邮箱可用性待核实','发送内容与次数尚待企业批准'],createdAt:new Date().toISOString()};
}
