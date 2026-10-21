import type {AnalysisRow} from './company-analysis-store';
import {competitorRoleLabel} from '@/domain/competitor-role-label';
import {checkedMarketReport} from '@/domain/market-research';
import {checkBuyer} from '@/domain/company-buyers';
import {marketKey} from '@/domain/target-markets';
import {checkedQuality} from './company-reviewed-analysis';
import {draftGroups} from './company-analysis-model';
import {marketInputHash} from './market-research-summary';
export function developmentGroups(row:AnalysisRow,snapshot:any){
  const groups=row.data.report?draftGroups(row.data.input,row.data.report).filter(g=>marketKey(g.market)===marketKey(snapshot.market)):[];
  const rejected:Array<{profileId:string;reason:string}>=[];
  if(snapshot.inputHash!==marketInputHash(row,snapshot.market))return {groups:[],rejected:[{profileId:'',reason:'企业资料已变化，市场计划需要更新'}]};
  const quality=checkedQuality(row.data.report,row.data.input,row.data.sources);
  let report;try{report=checkedMarketReport(snapshot.report,snapshot.sources);}catch{return {groups:[],rejected:[{profileId:'',reason:'市场报告依据检查未通过'}]};}
  for(const rec of report.searchRecommendations||[]){
    const draft=quality?.draft.buyers.find(b=>b.id===rec.profileId),group=groups.find(g=>g.profileId===rec.profileId);
    if(!draft||!group||marketKey(rec.market)!==marketKey(snapshot.market)||!quality!.buyers.find(b=>b.id===rec.profileId)?.ready){rejected.push({profileId:rec.profileId,reason:'不是当前已检查的客户方向／市场'});continue;}
    const checked=checkBuyer({...draft,priority:rec.priority,queries:rec.queries},quality!.statements,row.data.input.market,row.data.input.intent);
    const queries=checked.queries.filter(q=>marketKey(q.market)===marketKey(snapshot.market));
    if(!checked.ready||!queries.length){rejected.push({profileId:rec.profileId,reason:checked.reasons.join('；')||'无本国查询'});continue;}
    group.keywords=queries.map(q=>q.text);group.searchSpecs=queries.map(q=>({query:q.text,business:q.business,buyerRole:q.roleTerm!,language:q.language,market:group.market,
      marketMode:row.data.input.marketMode||'headquarters',direction:checked.transaction.direction,verify:[...new Set([...q.verify,...rec.verify])]}));
    group.unknowns=[...new Set([...group.unknowns,...rec.verify])];
    Object.assign(group,{marketReason:rec.reason,marketRevision:snapshot.revision||1,priority:rec.priority});
  }
  return {groups,rejected};
}
export function createDevelopmentPlan(row:AnalysisRow,snapshot:any){
  const selected=developmentGroups(row,snapshot),quality=checkedQuality(row.data.report,row.data.input,row.data.sources);
  return {title:`${row.data.input.companyName} × ${snapshot.market} 拓客计划`,analysisId:row.id,analysisVersion:row.version,
    inputHash:snapshot.inputHash,market:snapshot.market,revision:snapshot.revision||1,
    status:quality&&selected.groups.some(g=>g.ready)?'ready_with_unknowns':'needs_information',
    groups:selected.groups.map(g=>({...g,ready:g.ready&&!!quality?.buyers.find(b=>b.id===g.profileId)?.ready})),
    rejectedRecommendations:selected.rejected,
    coverage:{marketTotal:null,desiredCount:'期望数量由用户设置；不保证市场存在该数量',strategy:'先覆盖优先买方群体，按新增适配企业、重复率、来源质量及预算继续',
      reuse:'执行前复用相关旧企业与来源，按同组及关联组提交域名排除；修改名称不清空历史',stop:'预算到达、来源受限或低新增时保存已完成及未覆盖范围'},
    gaps:[...snapshot.report.unknowns,...(!snapshot.report.usps?.length?['结构化USP尚待分析']:[]),
      ...(!snapshot.report.competitors.some((c:any)=>c.presence?.status==='local_evidence')?['当地竞品经营尚缺正文核实']:[])],
  };
}
export function developmentPlanMarkdown(snapshot:any){
  const p=snapshot.developmentPlan,r=snapshot.report;
  const label=(c:any)=>`[${c.kind==='fact'?'来源事实':c.kind==='hypothesis'?'合作假设':'未知'}] ${c.text}`;
  const sources=(c:any)=>(c.references||[]).map((ref:any)=>{const s=snapshot.sources.find((s:any)=>s.id===ref.sourceId);return `  - 依据：${ref.quote}\n    来源：${s?.url||s?.title||ref.sourceId}；采集：${s?.retrievedAt||'未知'}`;});
  const lines=[`# ${p?.title||snapshot.market+'拓客计划'}`,`资料版本：${p?.analysisVersion||'待整理'}；市场：${snapshot.market}`,r.summary,'\n## 产品／服务'];
  for(const o of r.offerings||[])lines.push(`### ${o.name}`,label(o.description),...sources(o.description),...o.applications.map(label));
  lines.push('\n## USP与适用价值');for(const u of r.usps||[])lines.push(`### ${u.product}`,label(u.feature),...sources(u.feature),label(u.value),label(u.comparison),...sources(u.comparison));
  lines.push('\n## 客户与渠道');for(const c of [...r.buyers,...r.channels])lines.push(label(c),...sources(c));
  lines.push('\n## 我方竞争者与替代方案');for(const c of r.competitors){lines.push(`### ${c.name}`,`与我方关系：${competitorRoleLabel(c.role)}`,`当地经营：${c.presence?.status==='local_evidence'?'有正文证据':c.presence?.status==='export_only'?'仅出口线索':'待核实'}`);
    for(const v of [...c.claims,...c.presence?[c.presence.evidence]:[],...c.products||[],...c.prices||[],...c.services||[]])lines.push(label(v),...sources(v));}
  lines.push('\n## 产品／服务竞争力');for(const c of r.competitiveness)lines.push(`### ${c.dimension}`,...[c.ourPosition,c.marketRequirement,c.assessment].flatMap(v=>[label(v),...sources(v)]));
  lines.push('\n## 进入条件');for(const c of r.entryConditions||[])lines.push(`### ${c.topic}`,label(c.requirement),...sources(c.requirement),label(c.ourReadiness),...sources(c.ourReadiness),`行动：${c.action}`);
  lines.push('\n## 可执行搜索组');for(const g of p?.groups||[])lines.push(`### ${g.label}`,`${g.ready?'可预览执行':'待补充'}；${g.role}；${g.application}`, ...g.keywords.map((q:string)=>`- ${q}`),...g.unknowns.map((v:string)=>`- 核实：${v}`));
  lines.push('\n## 预算、覆盖与未知',p?.coverage.strategy||'等待整理',p?.coverage.reuse||'',p?.coverage.stop||'',...(p?.gaps||r.unknowns).map((v:string)=>`- ${v}`));
  return lines.join('\n')+'\n';
}
