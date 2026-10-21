'use client';
import type {qualityView} from '@/server/company-reviewed-analysis';
export type QualityView=ReturnType<typeof qualityView>;
const names:Record<string,string>={installation:'现场安装',training:'培训',maintenance:'维护与售后',
  local_team:'当地团队',delivery:'供货与交付',certification:'认证资质',capacity:'产能与起订量',product_form:'产品形态'};
const states={yes:'资料已说明',no:'明确不提供',unknown:'已记录不确定，不重复追问',conflict:'资料有冲突'};
const regions:Record<string,string>={domestic:'国内',overseas:'海外',global:'全球'};
export default function CompanyQualityPanel({quality}:{quality:QualityView | null}) {
  if(!quality) return <p className="analysis-notice">这是历史报告，保留供查看。请更新企业分析，通过当前检查后再生成搜索计划。</p>;
  return <section aria-label="企业资料检查">
    <p role="status" className="analysis-notice">{quality.status==='partial'?'部分内容需要核实，有依据的资料已保留。':'已完成资料引用和买方关系检查。'} {quality.notice}</p>
    {quality.goals.length>0 && <section><h3>拓展目标</h3><ul>{quality.goals.map((s,i)=><li key={i}>{s}</li>)}</ul>
      <p className="muted">目标用于确定研究方向，不代表已经具备当地供货或服务能力。</p></section>}
    {quality.matters.length>0 && <details><summary>已了解的企业事项（{quality.matters.length}）</summary>
      <ul>{quality.matters.map(m=><li key={m.key}><strong>{names[m.topic] || m.topic}</strong> · {regions[m.region] || m.region || '地区未限定'} · {states[m.status]}
        <p>{m.quotes.join('；')}</p></li>)}</ul></details>}
    {quality.statements.length>0 && <details><summary>查看每项资料依据与范围</summary>
      {quality.statements.map(s=><article key={s.id}><p>{s.context}</p><small>{s.provenance}，尚未独立核实
        {s.product?` · 产品：${s.product}`:''}{s.region?` · 地区：${s.region}`:''} · {({current:'当前资料',past:'历史资料',planned:'计划',unknown:'时间未明确'})[s.period]}</small></article>)}</details>}
    {quality.issues.length>0 && <details><summary>查看未通过的检查（{quality.issues.length}）</summary>
      <ul>{quality.issues.map((s,i)=><li key={i}>{s}</li>)}</ul><p>原始分析保留。补充或修正企业资料后，可重新分析；不会自动反复调用模型。</p></details>}
  </section>;
}
