export function qualityCounts(project:any,q:any){
  const coverage=project.discoveryPolicy?.mode==='coverage';
  return [[coverage?'期望数量':'有效目标',coverage?project.discoveryPolicy.expectedTarget||'未指定':project.target],['独立候选',q.candidates],['有效企业',q.qualified],['待核实',q.pending],['不适配',q.unfit],['可联系企业',q.contactable],['可发邮件企业',q.emailReady],[coverage?'市场总量':'尚缺有效企业',coverage?'未知':q.remaining]];
}
export function QualityPanel({project,quality:q}:{project:any;quality:any}){
  if(!q)return null;
  const group=project.buyerGroup;
  return <section className="search-panel" aria-label="搜索计划与质量">
    <h2>{group?.label||'历史候选资料'}</h2>
    {group?<><p>买家业务：{group.application} · 合作角色：{group.role}</p><p>目标市场：{project.country} · {({headquarters:'总部所在地',operating_presence:'在当地经营',service_coverage:'服务覆盖当地'} as Record<string,string>)[group.searchSpecs?.[0]?.marketMode]||'地区含义需核实'}</p>
      <details><summary>查看 AI 生成的搜索条件与查验重点</summary>{group.searchSpecs?.map((s:any,i:number)=><article key={i}><p>{s.query}</p><small>{s.verify?.join?.('；')||s.verify}</small></article>)}</details></>:<p>历史名单保留原始资料。新付费搜索需先完成当前企业分析。</p>}
    <div className="search-stat-grid">{qualityCounts(project,q).map(([label,value])=><article className="search-stat" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <p>核实覆盖率 {(q.coverage*100).toFixed(1)}% · 有效率 {(q.qualificationRate*100).toFixed(1)}%（分母：全部独立候选）</p>
    <p>复用历史候选 {q.reusedCandidates||0} 家 · 当前排除 {q.excludedDomains} 个官网 · 精确缓存命中 {q.cacheHits} 次 · 返回重复 {q.duplicates} 条</p>
    <p>本任务最多 {project.maxRequests||0} 次请求 · USD {project.maxSpendUsd||0}；已预留 USD {q.reservedUsd.toFixed(2)} · 实际费用 {q.actualUsd===null?'待供应商核对':`USD ${q.actualUsd.toFixed(2)}`}</p>
    <small>有效企业表示适配有依据。采购意愿、邮箱核验和发送授权仍需各自确认。</small>
  </section>;
}
