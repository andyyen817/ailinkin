/** Career statements remain source claims; collection time does not prove current employment. */
export function contactCareerClaims(person,evidence){
  const claims=[],unknowns=[];
  const originals=person.positions||[];
  for(const original of originals){
    const refs=evidence.filter(e=>original.evidence.some(r=>r.id===e.id&&r.quote===e.quote));
    const supports=v=>!v||refs.some(e=>e.quote.includes(person.name)&&e.quote.includes(v));
    if(!refs.length||![original.employer,original.title,original.period].every(supports)){
      unknowns.push('职业经历缺少与姓名关联的逐项原文依据，未当作事实采用');continue;
    }
    claims.push({employer:original.employer,title:original.title,period:original.period||'',status:original.status,
      verification:refs.some(e=>e.imageId)?'image_claim_needs_review':'source_claim_unverified',evidence:refs});
  }
  if(!originals.length&&person.employer){
    const refs=evidence.filter(e=>e.quote.includes(person.name)&&e.quote.includes(person.employer));
    if(refs.length)claims.push({employer:person.employer,title:person.title&&refs.some(e=>e.quote.includes(person.title))?person.title:'',
      period:(person.employmentDates||[]).filter(d=>refs.some(e=>e.quote.includes(d))).join(' / '),
      status:person.relationship==='former_employee'?'former_claim':'timing_unknown',verification:refs.some(e=>e.imageId)?'image_claim_needs_review':'source_claim_unverified',evidence:refs});
  }
  return {careerHistory:[...new Map(claims.map(p=>[JSON.stringify(p),p])).values()],careerUnknowns:unknowns};
}
