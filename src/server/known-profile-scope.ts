export function knownProfileScope(s:any){
  if(s?.batchType!=='known_profile_emails')return null;
  const people=(s.targets||[]).flatMap((t:any)=>(t.personIds||[]).map((personId:string)=>({campaignId:t.campaignId,companyId:t.companyId,personId})));
  const fallback=!!s.fallbackCompanyId&&!!s.fallbackEvidence&&s.targets?.some((t:any)=>t.companyId===s.fallbackCompanyId&&t.personIds.length===13);
  if(people.length!==63||new Set(people.map((p:any)=>p.personId)).size!==63||s.targets?.length!==3||
    s.targets.map((t:any)=>t.personIds.length).sort((a:number,b:number)=>a-b).join(',')!=='13,25,25'||s.maxPeople!==63||
    !s.approvalEvidence||s.sources?.length!==(fallback?3:2)||s.sources.some((v:any)=>!['prospeo','hunter'].includes(v.provider)||v.maxCostUsd!==0||v.fields?.join(',')!=='work_email')||
    s.limits.finder!==(fallback?76:63)||s.limits.verifications!==63||['searches','pages','network','images','models','usd','apollo'].some(k=>s.limits[k]!==0))return null;
  if(people.some((p:any)=>!/^PI-[a-f0-9]{32}$/.test(p.personId)||!p.campaignId||!p.companyId))return null;
  return {...s,people};
}
