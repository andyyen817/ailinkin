import {validateContactPeople} from './contact-evidence-validator.mjs';
export const contactReviewVersion='contact-output-review-v3-career';
export function reviewContactOutput(raw,input){
  if(!raw||!Array.isArray(raw.people)||!Array.isArray(raw.unknowns))throw Error('CONTACT_OUTPUT_STRUCTURE');
  const people=[],rejected=[],normalized=[],rejectedOptional=[];
  for(const original of raw.people){
    const person=structuredClone(original);
    if(typeof person.employmentDates==='string'){
      person.employmentDates=person.employmentDates.trim()?[person.employmentDates]:[];
      normalized.push({name:person.name,field:'employmentDates',original:original.employmentDates});
    }
    const dateTooLong=Array.isArray(person.employmentDates)&&person.employmentDates.some(v=>typeof v==='string'&&v.length>100);
    if(dateTooLong){rejectedOptional.push({name:person.name,field:'employmentDates',original:original.employmentDates,reason:'日期字段超过原结构上限，原文仍保留'});delete person.employmentDates;}
    try{const result=validateContactPeople({people:[person],unknowns:[]},input);
      for(const p of result.people){
        if(dateTooLong)p.detailUnknowns.push('任职日期字段未通过格式检查，完整原文保留在引用和原始响应。');
        p.detailUnknowns.push(...raw.unknowns.filter(v=>typeof v==='string'&&v.includes(p.name)).map(v=>'模型提示（需核实）：'+v));
        if(p.relationship==='founder'&&!p.evidence.some(e=>new RegExp('founder|pendiri|创始人|創始人|创办人|創辦人','i').test(e.quote))){
          p.relationship='mentioned';p.rejectedRelationship='founder';p.detailUnknowns.push('原文未明确创始人关系；保留原职位，主体和合作关系待核实。');
        }
        const normalize=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
        if(p.employerClaim&&![input.company.name,...(input.company.verifiedAliases||[])].some(n=>normalize(n)===normalize(p.employerClaim))){
          p.affiliationStatus='employer_name_differs';p.detailUnknowns.push(`原文任职企业为${p.employerClaim}，与研究企业名称不同；主体关系待核实。`);
        }
      }
      people.push(...result.people);
    }
    catch(error){rejected.push({original,reason:String(error.message||error)});}
  }
  const extra=validateContactPeople({people:[],unknowns:raw.unknowns,...(raw.researchNeeds?{researchNeeds:raw.researchNeeds}:{})},input);
  return {...extra,people,rejected,rejectedOptional,normalized,reviewVersion:contactReviewVersion,
    unknowns:[...extra.unknowns,...(rejected.length?[`${rejected.length}条人物输出未通过原文/结构检查，原始响应和原因保留。`]:[])]};
}
