'use client';
import {platformCatalog} from '../../../scripts/research/platform-catalog.mjs';
const states:Record<string,string>={pending:'仍有待处理项',blocked:'有受限入口',unknown:'结果未知，停止重发',scope_limited:'本轮范围或额度不足',read_partial:'已读取部分公开页面',search_only:'只有搜索片段',not_started:'尚未研究'};
export function ContactDepthPanel({coverage=[]}:{coverage?:any[]}){
  return <section aria-label="逐平台研究覆盖"><h3>平台深度与未完成项</h3>
    <p>搜索片段与社媒正文分别计数。已处理本轮页面不代表已找到所有人员；受限、待核实和未覆盖来源继续保留。</p>
    {!coverage.length&&<p>先建立已确认企业的研究批次。</p>}
    <div className="platform-grid">{coverage.map(c=><article key={c.companyId+c.platform}>
      <strong>{c.companyName} · {platformCatalog[c.platform]?.label||c.platform}</strong><p>{states[c.state]||c.state}</p>
      <p>查询 {c.queries} 次 · 片段 {c.snippets} 条 · 读取 {c.pagesRead} 页</p>
      <p>相关来源 {c.admittedSources||0} · 主体待核实 {c.heldSources||0} · 无关来源 {c.rejectedSources||0}；原资料保留</p>
      <p>待处理 {c.pending} · 受限 {c.blocked} · 范围外 {c.outside} · 未知 {c.unknown}</p><p>{c.notice}</p>
      {!!c.sources.length&&<details><summary>查看 {c.sources.length} 个入口与读取状态</summary>{c.sources.map((s:any)=><p key={s.url}>
        <a href={s.url} target="_blank" rel="noreferrer">来源页面</a> · 深度 {s.depth} · {s.state}<br/>{s.reason}<br/>账号归属：{s.identity==='unconfirmed'?'待核实':'已观察到链接关系，仍需确认主体'}</p>)}</details>}
    </article>)}</div>
  </section>;
}
