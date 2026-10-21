export function freeContactFollowupScope(s:any){
  if(s?.batchType!=='free_contact_followup')return null;
  const people=(s.targets||[]).flatMap((t:any)=>(t.personIds||[]).map((personId:string)=>({campaignId:t.campaignId,companyId:t.companyId,personId})));
  const limits={searches:47,pages:64,network:256,images:0,models:0,usd:0,apollo:0,finder:22,verifications:35};
  const routes=['prospeo:/enrich-person','hunter:/v2/email-finder','hunter:/v2/email-verifier','langsearch:/v1/web-search','public:page'];
  const clearance=s.prospeoClearance,checked=Date.parse(clearance?.checkedAt),unlocked=!!clearance?.evidence&&clearance.dailyLimit===50&&Number.isInteger(clearance.remainingRequests)&&clearance.remainingRequests>=22&&clearance.remainingRequests<=50&&Number.isFinite(checked)&&checked<=Date.now()&&Date.now()-checked<3600000;
  if(people.length!==65||new Set(people.map((p:any)=>p.personId)).size!==65||s.targets?.length!==3||s.targets.map((t:any)=>t.personIds.length).sort((a:number,b:number)=>a-b).join(',')!=='15,25,25'||s.maxPeople!==65||
    s.previousScope!=='CONTACT-USABLE-20261017'||!s.approvalEvidence||!s.quotaAdjustmentEvidence||s.hunterCreditLimit!==17.5||!Object.entries(limits).every(([k,v])=>s.limits?.[k]===v)||
    s.finderPersonIds?.length!==10||new Set(s.finderPersonIds).size!==10||s.finderPersonIds.some((id:string)=>!people.some((p:any)=>p.personId===id))||
    s.sources?.length!==5||new Set(s.sources.map((v:any)=>v.provider+':'+v.endpoint)).size!==5||s.sources.some((v:any)=>!routes.includes(v.provider+':'+v.endpoint)||v.maxCostUsd!==0||v.fields?.join(',')!=='work_email'||v.modelTransfer!==false)||
    !s.sources.find((v:any)=>v.provider==='hunter'&&v.endpoint==='/v2/email-finder')?.disabledReason||!s.targets.some((t:any)=>t.companyId===s.prospeoCompanyId&&t.personIds.length===25)||!['public_first','enrich_after_reset'].includes(s.stage)||
    (!s.sources.find((v:any)=>v.provider==='prospeo')?.disabledReason&&!unlocked)||s.stage==='enrich_after_reset'&&!unlocked||people.some((p:any)=>!/^PI-[a-f0-9]{32}$/.test(p.personId)||!p.campaignId||!p.companyId))return null;
  return {...s,people};
}
export const personPageOptions=(scope:any)=>['free_contact_followup','free_email_ownership','free_contact_alternative','free_tomba'].includes(scope?.batchType)?{maxImages:0,browser:false}:{maxImages:2,browser:true};
export const personSearchQuery=(scope:any,query:string)=>scope?.batchType==='free_contact_followup'?query.replace(/\s+\(email OR contact\)$/,''):query;
