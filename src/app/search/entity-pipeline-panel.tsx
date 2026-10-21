'use client';
import {observedMarketLinks} from '../../../scripts/research/buyer-site-pages.mjs';
export function EntityPipelinePanel({pipeline:p,milestone,busy,owner,onRun}:{pipeline:any;milestone?:any;busy:boolean;owner:boolean;onRun:(stage:string,entityId?:string,resolutionPlan?:string,renderEmptyHtml?:boolean,targetPageUrl?:string)=>void}){
  if(!p?.sourcePages)return null;
  const stages:Record<string,string>={prepare:'整理已保存来源',extract:'AI识别被提及企业',resolve:'定位企业官网',verify:'核实官网与买方关系','read-sites':'读取官网资料','verify-batch':'批量核实官网与买方关系'};
  const labels:Record<string,string>={'buyer-name-v2':'按名称与业务定位官网','buyer-alias-v2':'查资料中的相关名称','buyer-market-v2':'查询目标地区运营资料','apollo-name-v1':'用 Apollo 核对企业主体'};
  const blocked=p.execution?.available===false;
  return <section className="search-panel" aria-label="来源到买家研究">
    <h2>从来源资料识别真实买家</h2>
    {milestone&&<div role="status" aria-label="三家目标客户进度"><h3>本轮目标：至少 {milestone.target} 家独立目标客户</h3><p>已核实符合条件 {milestone.qualified} 家 · 还需 {milestone.remaining} 家 · 候选记录 {milestone.candidateRecords} 条（身份与别名待核实）</p><p>{milestone.reached?'数量已达到，请逐家复核证据。':'继续定位官网、读取资料并核实买方关系。'}</p></div>}
    <p>新闻、目录和博客是线索。系统先找出文中企业，再定位官网并核实身份、目标市场和合作关系。</p>
    {blocked&&<p role="note">本轮执行窗口未开放、已到期或存在未知请求。可以查看保存资料与查询预览；新增调用需有效授权。</p>}
    <div className="search-stat-grid">{[['来源页面',p.sourcePages],['已识别组织',p.entityCount],['待定位官网',p.unresolved],['官网候选',p.officialCandidates]].map(([label,value])=><article className="search-stat" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <p>已处理来源 {p.sourcesProcessed} · 已确认官网归属 {p.ownershipVerified} · 历史来源候选 {p.legacySources}（原资料保留）</p>
    <div className="search-actions"><button disabled={busy||!owner||blocked||!p.nextStage} onClick={()=>onRun('buyers')}>{busy?'正在处理并保存…':'继续识别并核实买家'}</button></div>
    <div className="search-actions"><button disabled={busy||!owner||blocked} onClick={()=>onRun('read-sites')}>读取已定位官网资料</button><button disabled={busy||!owner||blocked} onClick={()=>onRun('verify-batch')}>批量核实已读取官网</button><button disabled={busy||!owner||blocked} onClick={()=>onRun('review-saved')}>复核已保存的判断（不调用模型）</button></div>
    <small>下一步：{stages[p.nextStage]||'查看结果及待核实事项'}。系统按已批准额度执行，结果未知或额度耗尽时停止。</small>
    {p.resolutionPause&&<p role="note">{p.resolutionPause} 请查看查询方式的效果，改用有依据的相关名称或组织数据入口。</p>}
    {p.budget&&<p>{blocked?'上轮记录剩余额度（本轮不可用）':'本轮剩余额度'}：企业提取及买方核实 {p.budget.ai} 次 · 官网定位 {p.budget.search} 次 · 页面读取 {p.budget.web} 次{p.budget.apolloCredits!==undefined&&<> · Apollo {p.budget.apolloCredits} 积分</>}；每批核实最多 5 家。</p>}
    {p.entities?.length>0&&<details><summary>查看识别的组织与官网定位查询</summary>{p.entities.map((e:any)=><article className="discovery-evidence" key={e.id}><h3>{e.name}</h3><p>{e.status} · {e.locatorOnly?'定位结果附带资料，保留':e.role==='potential_buyer'?'潜在买家，待核实':'本组不优先，资料保留'}</p>
      {e.website&&<a href={e.website} target="_blank" rel="noreferrer">官网候选 · 归属以核实结果为准 ↗</a>}
      <p>{e.resolution?.query?'最近执行的定位查询':'官网查询预览'}：{e.resolution?.query||e.locatorPlans?.[0]?.query||e.previewQuery}</p>
      {e.resolution?.audit&&<div><p>返回 {e.resolution.audit.returned} 条 · 提及企业 {e.resolution.audit.named} 条 · 官网候选 {e.resolution.audit.candidates} 个</p><p>{e.resolution.audit.reason}</p>
        <details><summary>查看本次定位结果及原因</summary>{e.resolution.audit.items.map((r:any,i:number)=><p key={i}><a href={/^https?:\/\//i.test(r.url||'')?r.url:undefined} target="_blank" rel="noreferrer">{r.title||r.url}</a><br/>{r.reason}</p>)}</details></div>}
      {!e.locatorOnly&&e.role==='potential_buyer'&&<div className="search-actions">
        {e.locatorPlans?.map((q:any)=><div key={q.id}><p><strong>{labels[q.id]}</strong><br/>{q.query}<br/><small>{q.reason}</small></p>
          <button disabled={busy||!owner||blocked||!p.execution?.allowedPlans?.includes(q.id)||!!e.resolutionAttempt||(!!e.website&&q.purpose!=='local_operator'&&!(q.provider==='apollo'&&!e.ownership?.verified))||e.locatorComparison?.some((r:any)=>r.status==='done'&&r.query===q.query&&r.provider===q.provider)} onClick={()=>onRun('resolve',e.id,q.id)}>{labels[q.id]}</button>
          <details><summary>查看本次来源与域名范围</summary><p>来源：{q.provider} · 目的：{q.purpose==='local_operator'?'当地经营核实':q.provider==='apollo'?'组织身份定位':'官网定位'}</p><p>限定域名：{q.includeDomains?.join('、')||'未限定'}<br/>排除域名：{q.excludeDomains?.join('、')||'无'}</p></details></div>)}
        <details><summary>查看历史查询方式</summary><button disabled={busy||!owner||blocked||!!e.website||e.resolution?.status==='done'} onClick={()=>onRun('resolve',e.id)}>定位这家官网</button>
          <button disabled={busy||!owner||blocked||!!e.website||!!e.resolutionAttempt||[...(e.resolutionHistory||[]),e.resolution].some((r:any)=>r?.status==='done'&&r.query===e.conciseQuery)} onClick={()=>onRun('resolve',e.id,'concise-v1')}>用简短查询定位官网</button><small>简短查询：{e.conciseQuery}。保留旧定位结果。</small></details>
        <button disabled={busy||!owner||blocked||!e.website} onClick={()=>onRun('read-sites',e.id)}>读取这家官网资料</button>
        <button disabled={busy||!owner||blocked||!e.websitePages?.some((r:any)=>r.content)} onClick={()=>onRun('verify-batch',e.id)}>核实这家买方关系</button>
        {e.websitePages?.some((r:any)=>r.readFailure==='页面正文不足或要求访问验证')&&<button disabled={busy||!owner||blocked} onClick={()=>onRun('read-sites',e.id,undefined,true)}>检查并读取动态正文</button>}
        {observedMarketLinks(e).map(url=><button key={url} disabled={busy||!owner||blocked} onClick={()=>onRun('read-sites',e.id,undefined,true,url)}>读取已发现的门店页面</button>)}
      </div>}
      {e.locatorComparison?.length>0&&<details><summary>比较已执行查询的实际效果</summary>{e.locatorComparison.map((r:any,i:number)=><p key={i}>{r.provider} · {r.query}<br/>返回 {r.returned} 条 · 名称相关 {r.named} 条 · 官网候选 {r.candidates} 个 · {r.saved?'保存资料复用':'接口结果'}<br/><small>官网归属：{e.ownership?.verified?'已核实，需查看具体依据':'未确认'}；候选数量不代表有效客户。</small></p>)}</details>}
      {e.aliases?.length>0&&<p>资料提及的相关名称：{e.aliases.map((a:any)=>a.name+'（'+a.status+'）').join('、')}</p>}
      {e.websitePages?.length>0&&<details><summary>查看实际读取页面及范围（{e.websitePages.length}）</summary>{e.websitePages.map((v:any,i:number)=><div key={i}><a href={v.url} target="_blank" rel="noreferrer">{v.url}</a><p>{v.readFailure||v.content?.slice(0,800)||'没有正文'}</p><small>{v.retrievedAt} · {v.readScope||'读取失败'} · 展示正文摘录，完整记录已保存</small></div>)}</details>}
      {e.evidence.map((s:any,i:number)=><p key={i}><a href={s.url} target="_blank" rel="noreferrer">发现来源 ↗</a> · {s.quote}</p>)}</article>)}</details>}
    {p.suggestedQueries?.length>0&&<details><summary>查看下一批搜索建议（尚未执行）</summary>{p.suggestedQueries.map((s:any,i:number)=><p key={i}>{s.query}<br/>{s.reason}</p>)}</details>}
    <details><summary>查看全部来源页面（{p.sourcePages}）</summary>{p.sources.map((s:any)=><p key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title||s.url} ↗</a><br/>{s.status||'待识别企业'} · {s.kind||'归属待核实'}</p>)}</details>
  </section>;
}
