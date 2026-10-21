import 'server-only';
export function operatorContactStatus(campaign:any,person:any){
  const attempts=campaign.data.operatorContactAttempts||[];
  const latest=attempts.findLast((p:any)=>p.companyId===person.companyId&&(person.identityRefs?.includes('source:'+p.sourcePersonId)||p.profileUrl&&p.profileUrl===person.profileUrl));
  if(latest)return {status:latest.status,reason:latest.reason};
  const steps=(campaign.data.personResearchBatches||[]).flatMap((b:any)=>b.steps.filter((s:any)=>['finder','email_finder'].includes(s.kind)&&b.people.some((p:any)=>p.personId===s.personId&&(p.rowId===person.id||p.personId===person.personId))));
  if(steps.some((s:any)=>s.state==='done'&&s.result?.state==='not_found'))return {status:'未找到',reason:'已查询的来源未找到个人邮箱；保留原始回执和个人主页，继续下一位。'};
  if(steps.some((s:any)=>['failed','unknown','reserved','skipped'].includes(s.state)))return {status:'来源受限',reason:'历史查询未取得确定结果；已保留失败计数，不重复消耗额度。'};
  return {status:'未查询',reason:'尚无工作邮箱查询回执；本批免费额度未覆盖，保留资料等待后续批次。'};
}
