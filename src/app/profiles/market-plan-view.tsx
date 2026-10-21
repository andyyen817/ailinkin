'use client';
import type {ReactNode} from 'react';
export function MarketPlanView({snapshot,busy,onPlan,claim}:{snapshot:any;busy:boolean;onPlan?:(id:string,market:string)=>void;claim:(c:any)=>ReactNode}){
  const r=snapshot.report,p=snapshot.developmentPlan;
  function download(){if(!p?.markdown)return;const url=URL.createObjectURL(new Blob([p.markdown],{type:'text/markdown;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`${p.title.replace(/[<>:"/\\|?*]/g,'_')}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section aria-label="完整市场拓客计划"><h3>{p?.title||'企业×目标市场拓客计划'}</h3>
    {p?<><p>企业资料版本 {p.analysisVersion} · 市场计划版本 {p.revision} · {p.status==='ready_with_unknowns'?'已有可预览的搜索方向；未知事项继续核实':'需要补齐关键资料或客户方向'}</p>
      <button type="button" onClick={download}>下载完整拓客计划</button></>:<p>先点击整理完整拓客计划，复用已有资料并保存当前版本。</p>}
    <h3>重点产品／服务</h3>{r.offerings?.length?r.offerings.map((o:any,i:number)=><article key={i}><h4>{o.name}</h4>{claim(o.description)}{o.applications.map((c:any,j:number)=><div key={j}>{claim(c)}</div>)}</article>):<p>暂无结构化产品分析；查看企业资料，更新分析后按产品比较。</p>}
    <h3>USP：产品特点与客户价值</h3><p>企业特点不自动等于独有优势；客户价值与竞品差异按证据状态展示。</p>
    {r.usps?.length?r.usps.map((u:any,i:number)=><article key={i}><h4>{u.product}</h4><h5>产品特点</h5>{claim(u.feature)}<h5>可能给买方的价值</h5>{claim(u.value)}<h5>与市场方案比较</h5>{claim(u.comparison)}</article>):<p>USP尚未完成结构化分析，没有把宣传语作为已核实优势。</p>}
    <h3>进入市场的条件</h3>{r.entryConditions?.length?r.entryConditions.map((e:any,i:number)=><article key={i}><h4>{e.topic}</h4><h5>当地要求</h5>{claim(e.requirement)}<h5>我方准备情况</h5>{claim(e.ourReadiness)}<p>建议行动：{e.action}</p></article>):<p>当地交付、服务及资质条件仍待研究，不从目标市场推导供货能力。</p>}
    <h3>可执行的买方搜索组</h3>{p?.groups?.length?p.groups.map((g:any)=><article key={g.semanticKey}><h4>{g.label}</h4><p>{g.role} · {g.application} · {g.market}</p>
      {g.marketReason&&claim(g.marketReason)}<p>{g.keywords.join(' / ')}</p>{g.unknowns.map((v:string,i:number)=><p key={i}>核实：{v}</p>)}
      <button type="button" disabled={busy||!g.ready||!onPlan} onClick={()=>onPlan?.(g.profileId,g.market)}>预览此组搜索计划</button></article>):<p>尚无可执行买方组；补充企业信息或查看客户分析中的检查原因。</p>}
    {p&&<><h3>预算与覆盖策略</h3><p>{p.coverage.desiredCount}</p><p>{p.coverage.strategy}</p><p>{p.coverage.reuse}</p><p>{p.coverage.stop}</p>
      {!!p.rejectedRecommendations.length&&<p>有 {p.rejectedRecommendations.length} 项市场查询未通过原有买方检查，保留原方向及核实原因。</p>}
      <details><summary>计划仍待核实的事项（{p.gaps.length}）</summary>{p.gaps.map((v:string,i:number)=><p key={i}>{v}</p>)}</details></>}
  </section>;
}
