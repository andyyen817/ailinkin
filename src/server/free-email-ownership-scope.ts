export function freeEmailOwnershipScope(s:any){
  if(s?.batchType!=='free_email_ownership')return null;
  const people=(s.targets||[]).flatMap((t:any)=>(t.personIds||[]).map((personId:string)=>({campaignId:t.campaignId,companyId:t.companyId,personId})));
  const limits={searches:40,pages:16,network:256,images:0,models:0,usd:0,apollo:0,finder:0,verifications:20};
  const routes=['hunter:/v2/email-verifier','langsearch:/v1/web-search','public:page'];
  if(s.publicStage&&!['initial','focused_serenitea'].includes(s.publicStage))return null;
  if(s.queryOverrides){const entries=Object.entries(s.queryOverrides) as [string,string[]][];
    if(entries.length!==3||entries.some(([id,queries])=>!people.some((p:any)=>p.personId===id&&p.companyId!==s.ownershipCompanyId)||!Array.isArray(queries)||queries.length!==3||queries.some(q=>typeof q!=='string'||!q.trim()||q.length>300)))return null;}
  if(s.publicStage==='focused_serenitea'&&!s.queryOverrides)return null;
  if(people.length!==26||new Set(people.map((p:any)=>p.personId)).size!==26||s.targets?.length!==2||s.targets.map((t:any)=>t.personIds.length).sort((a:number,b:number)=>a-b).join(',')!=='11,15'||s.maxPeople!==26||s.minutes!==60||
    s.previousScope!=='CONTACT-CONTINUE-20261017'||!s.approvalEvidence||s.hunterCreditLimit!==10||s.manualPageLimit!==24||!Object.entries(limits).every(([k,v])=>s.limits?.[k]===v)||
    !Array.isArray(s.knownEmails)||new Set(s.knownEmails).size!==20||s.knownEmails.some((v:string)=>!/^\S+@\S+\.\S+$/.test(v))||s.exportTargets?.length!==3||new Set(s.exportTargets.map((v:any)=>v.companyId)).size!==3||s.exportTargets.some((v:any)=>!people.some((p:any)=>p.campaignId===v.campaignId))||
    s.sharedEmails?.length!==3||s.sharedEmails.reduce((n:number,v:any)=>n+(v.personIds?.length||0),0)!==11||s.sharedEmails.some((v:any)=>!s.knownEmails.includes(v.email)||v.personIds.some((id:string)=>!people.some((p:any)=>p.personId===id&&p.companyId===s.ownershipCompanyId)))||
    s.sources?.length!==3||new Set(s.sources.map((v:any)=>v.provider+':'+v.endpoint)).size!==3||s.sources.some((v:any)=>!routes.includes(v.provider+':'+v.endpoint)||v.maxCostUsd!==0||v.fields?.join(',')!=='work_email'||v.modelTransfer!==false)||
    people.some((p:any)=>!/^PI-[a-f0-9]{32}$/.test(p.personId)||!p.campaignId||!p.companyId))return null;
  return {...s,people};
}
export function ownershipQueries(scope:any,person:any){
  if(scope.publicStage==='focused_serenitea')return scope.queryOverrides[person.personId]||[];
  const name=person.name.replaceAll('"',''),company=person.companyName.replaceAll('"','');
  const shared=scope.sharedEmails.find((v:any)=>v.personIds.includes(person.personId));
  if(shared)return [`"${shared.email}" "${name}"`,...(shared.personIds[0]===person.personId?[`"${shared.email}"`]:[])];
  return [`"${name}" "${company}" email`,...(!person.profileUrl?[`"${name}" "${company}" contact`]:[])];
}
export function reuseOwnershipEmail(scope:any,step:any,observations:any[],now=Date.now()){
  if(!['free_email_ownership','free_contact_alternative','free_tomba'].includes(scope.batchType)||step.kind!=='verify'||!scope.knownEmails.includes(step.input.email.toLowerCase()))return null;
  const prior=observations.findLast(o=>o.result?.email?.toLowerCase()===step.input.email.toLowerCase()&&o.result.technical&&!o.result.technical.pending&&Date.parse(o.result.technical.verifiedAt)<=now&&Date.parse(o.result.technical.expiresAt)>now);
  if(!prior)throw Error('KNOWN_EMAIL_REVIEW_REQUIRED_NO_NEW_VERIFICATION');
  return {...structuredClone(prior.result),reusedFrom:prior.key,notice:'复用已有邮箱验证结论；本轮只验证新找到的地址，不改变人物归属。'};
}
