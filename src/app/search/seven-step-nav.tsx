'use client';
export function SevenStepNav({tenantId,project,quality,selectedCount}:{tenantId:string;project:any;quality:any;selectedCount:number}){
  const profile=`/profiles?tenantId=${tenantId}${project.analysis?.id?'&analysisId='+project.analysis.id:''}`;
  const stages=[['企业资料与市场',profile,'已有企业资料与目标市场'],['市场分析',profile,'客户方向已有；竞争结论按实际证据'],['客户潜力',profile,'市场总量未知时展示已发现下限'],
    ['企业初筛','#enterprise-shortlist',`有适配依据 ${quality?.qualified||0} 家`],['选择深研企业','#enterprise-shortlist',selectedCount?`已确认 ${selectedCount} 家`:'等待用户选择'],
    ['人员与联系资料','#contact-batch','逐企业、逐平台记录覆盖与缺项'],['选择邮件对象','#contact-review','用户确认收件、内容和发送范围']];
  return <nav className="seven-step-nav" aria-label="七步获客流程">{stages.map(([label,url,state],i)=><a href={url} key={label}><strong>{i+1}. {label}</strong><small>{state}</small></a>)}</nav>;
}
