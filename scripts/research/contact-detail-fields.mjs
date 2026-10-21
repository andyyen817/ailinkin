export function contactDetailFacts(person,evidence){
  const quoted=value=>evidence.some(e=>e.quote.includes(person.name)&&e.quote.includes(value));
  const rejected=[],employerClaim=person.employer&&quoted(person.employer)?person.employer:'';
  if(person.employer&&!employerClaim)rejected.push('任职企业没有与姓名关联的文字依据');
  const employmentDates=(person.employmentDates||[]).filter(v=>{if(quoted(v))return true;rejected.push('任职日期缺少原文依据：'+v);return false;});
  const contacts=[];
  for(const c of person.contacts||[]){
    const safeLink=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port;}catch{return false;}};
    if(!quoted(c.value)||c.kind==='email'&&!/^[^\s@,;]+@[^\s@]+\.[^\s@]+$/.test(c.value)||c.kind==='phone'&&!/^[+()\d][\d\s()+.-]{6,30}$/.test(c.value)||
      ['social','whatsapp'].includes(c.kind)&&!safeLink(c.value)&&!(c.kind==='whatsapp'&&/^[+()\d][\d\s()+.-]{6,30}$/.test(c.value))){
      rejected.push('个人渠道缺少同一段姓名与渠道原文，或格式无效');continue;
    }
    const generic=evidence.some(e=>e.quote.includes(c.value)&&/general contact|company email|contact us|customer service|公共邮箱|公司邮箱/i.test(e.quote));
    const imageOnly=!evidence.some(e=>!e.imageId&&e.quote.includes(person.name)&&e.quote.includes(c.value));
    const scope=imageOnly?'unknown':c.scope|| (generic?'unknown':'person');
    contacts.push({kind:c.kind,value:c.value,scope,verification:'ownership_needs_review',ownerName:scope==='person'?person.name:'',
      evidence:evidence.filter(e=>e.quote.includes(person.name)&&e.quote.includes(c.value))});
  }
  if(evidence.some(e=>e.imageId))rejected.push('截图识别字段须逐项核对图片；任职、日期和个人渠道归属尚未确认。');
  return {employerClaim,employmentDates,contacts,detailUnknowns:rejected,affiliationStatus:employerClaim?'source_claim_unverified':'unknown'};
}
export function plainTextEmails(blocks){
  const found=new Map();
  for(const b of blocks){
    for(const m of b.text.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,24}/gi)){
      const value=m[0];if(value.includes('..')||value.length>254)continue;
      const quote=b.text.slice(Math.max(0,m.index-80),Math.min(b.text.length,m.index+value.length+80));
      found.set(value.toLowerCase(),{kind:'email',value,scope:'unknown',verification:'ownership_needs_review',evidence:[{id:b.id,sourceUrl:b.sourceUrl,quote,retrievedAt:b.retrievedAt,contentHash:b.contentHash}]});
    }
  }
  return [...found.values()];
}
