'use client';
import {useEffect,useState} from 'react';
import {platformCatalog} from '../../../scripts/research/platform-catalog.mjs';
const states:Record<string,string>={ready:'浏览器已打开，尚未采集',needs_login:'该公开入口需要登录，免登录批次继续其他来源',needs_user_action:'平台弹窗阻挡读取，该入口暂缓',restricted:'入口要求验证或访问受限',rate_limited:'来源限流',robots_denied:'来源规则禁止本路径读取',robots_unknown:'来源规则暂无法确认',not_covered:'本批尚未覆盖',no_new_public_material:'未取得新的公开正文，资料缺口已保存',no_related_public_body:'本查询未取得相关正文',read_partial:'公开资料部分读取',search_unavailable:'没有找到可操作的搜索栏',budget_exhausted:'本批网站请求额度已用完',unrelated:'未读到相关社媒正文',unchanged:'资料相同，本次没有新增',read:'新社媒正文已保存',needs_visual_review:'新资料已整理，字段须核对',blocked:'本步未完成',closed:'浏览器已关闭',running:'正在处理'};
states.upstream_unavailable='检索服务暂时不可用，本批有限恢复后保留缺口';
states.reused='已复用成功保存的资料，本次未重新请求';states.retry_limit='已达到该网址的有限恢复次数';
export function BrowserContactPanel({tenantId,campaignId,companies,owner}:{tenantId:string;campaignId:string;companies:any[];owner:boolean}){
  const [view,setView]=useState<any>(null),[companyId,setCompany]=useState(''),[platform,setPlatform]=useState('FB'),[people,setPeople]=useState<any[]>([]),[personName,setPerson]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const base=`/api/v1/tenants/${tenantId}/contact-browser`,job=view?.jobs?.at(-1);
  useEffect(()=>{setCompany(companies[0]?.id||'');},[companies.map(c=>c.id).join('|')]);
  async function load(){const [a,b]=await Promise.all([fetch(`${base}?campaignId=${campaignId}`),fetch(`/api/v1/tenants/${tenantId}/contact-review?campaignId=${campaignId}`)]);
    if(!a.ok)throw Error('无法读取浏览器研究状态，请检查企业权限。');setView(await a.json());if(b.ok)setPeople((await b.json()).view.rows.filter((r:any)=>r.kind==='person'));}
  useEffect(()=>{void load().catch(e=>setMessage(e.message));},[base,campaignId]);
  async function perform(action:string,collectionId?:string){setBusy(true);setMessage('正在处理本轮浏览器任务');try{
    const payload={action,campaignId,companyId,platform,...(personName?{personName}:{}),...(collectionId?{collectionId}:{})};
    const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json();
    if(!r.ok)throw Error(d.error==='BROWSER_SCOPE_REQUIRED'?'本轮浏览器来源、期限和额度尚未启用。':d.error==='ENTERPRISE_SELECTION_STALE'?'请先确认企业研究名单。':d.error||'本步未完成，原资料保留。');
    setView(d);setMessage(states[d.job.state]||d.job.state);window.dispatchEvent(new Event('contact-batch-updated'));
  }catch(e){setMessage((e as Error).message);await load().catch(()=>{});}finally{setBusy(false);}}
  const available=owner&&view?.enabled&&!!companyId,canExplore=available&&!view?.budget?.exhausted;
  const anonymous=view?.scope?.mode==='anonymous_public';
  return <section className="search-panel" aria-label="可见浏览器社媒新采集" aria-busy={busy}>
    <h2>用浏览器搜索并采集新社媒资料</h2><p>优先免登录研究：系统使用独立匿名 Chrome，搜索公开入口，保存正文与必要截图。受限来源暂停，其他来源继续；不要求找到采购职位。</p>
    <p>当前执行模式：{anonymous?'免登录公开研究，不使用旧账号 Cookie':'尚未启用免登录批次；原平台研究入口保留'}</p>
    <div className="contact-review-tools"><label>浏览器研究企业<select value={companyId} onChange={e=>{setCompany(e.target.value);setPerson('');}}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>浏览器研究平台<select value={platform} onChange={e=>setPlatform(e.target.value)}>{Object.entries(platformCatalog).filter(([p])=>p!=='网页').map(([p,c])=><option key={p} value={p}>{c.label}</option>)}</select></label>
      <label>已有依据的人物<select value={personName} onChange={e=>setPerson(e.target.value)}><option value="">先搜索企业</option>{people.filter(p=>p.companyId===companyId).map(p=><option key={p.id} value={p.name}>{p.name}</option>)}</select></label></div>
    <p role="status">{message}</p>{!view?.enabled&&<p>本轮真实浏览器任务尚未启用或已到期；旧资料可查看，未开始新的采集。</p>}
    {view?.budget?.exhausted&&<p role="alert">本批网站请求额度已用完：{view.budget.usage.networkRequests}／{view.scope?.maxNetworkRequests} 次。采集已暂停，已保存资料保留。{view.budget.overrun&&'已记录实际超额，等待处理。'}</p>}
    <button disabled={busy||!canExplore||!anonymous} onClick={()=>void perform('public_batch')}>开始免登录研究</button>
    {personName&&<p>本次仅搜索所选人物在所选平台的公开资料；公司账号继续作为公共渠道，不绑定给个人。</p>}
    <button disabled={busy||!canExplore||!anonymous} onClick={()=>void perform('public_direct')}>读取官网已有公开账号</button>
    <button disabled={busy||!canExplore||!anonymous||!view?.scope?.personDiscovery} onClick={()=>void perform('public_discovery')}>读取公开帖子并发现人物</button>
    {!!view?.discoverySources?.some((s:any)=>s.companyId===companyId)&&<details><summary>有依据的公开资料入口</summary>{view.discoverySources?.filter((s:any)=>s.companyId===companyId).map((s:any)=><p key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.kind==='post'?'公司公开帖子':'关联人物页'}</a> · 来源：{s.parentUrl}；尚未读取内容，不代表已找到联系人。</p>)}</details>}
    {!anonymous&&<button disabled={busy||!canExplore} onClick={()=>void perform('open')}>打开社媒浏览器</button>}
    {!anonymous&&<button disabled={busy||!canExplore} onClick={()=>void perform('search_collect')}>搜索并采集新社媒资料</button>}
    <button disabled={busy||!available||!job?.browser?.visible||job.state==='closed'} onClick={()=>void perform('collect_current')}>采集浏览器当前公开页</button>
    <button disabled={busy||!owner||!companyId} onClick={()=>void perform('close')}>关闭当前社媒浏览器</button>
    {view?.scope&&<p>本批搜索最多 {view.scope.maxSearchQueries||'未配置'} 次；页面最多 {view.scope.maxPageReads} 次；网络最多 {view.scope.maxNetworkRequests} 次；模型最多 {view.scope.maxModelRequests} 次／US${view.scope.maxSpendUsd.toFixed(2)}。</p>}
    {view?.budget&&<p>已用搜索 {view.budget.usage.searchQueries||0} 次；页面 {view.budget.usage.pageReads} 次；网络 {view.budget.usage.networkRequests} 次。搜索尝试、规则检查和动态资源分别记实数。</p>}
    {job&&<article aria-label="本次浏览器采集结果"><h3>{job.companyName} · {platformCatalog[job.platform]?.label}</h3><p>{states[job.state]||job.state} · 本次新原文：{job.fresh?'已取得':'尚未取得'}</p>
      {job.reason&&<p>原因：{job.reason}</p>}{job.analysisError&&<p>图片整理尚未完成：{job.analysisError}</p>}
      {job.page?.url&&<p><a href={job.page.url} target="_blank" rel="noreferrer">实际社媒来源页</a> · {job.page.retrievedAt}</p>}
      <p>新正文 {job.page?.coverage?.charactersRead||0} 字；社媒截图 {job.images?.length||0} 张；人物提取 {job.people||0} 条。</p>
      {job.page?.pages?.map((p:any,i:number)=><details key={i}><summary>页面诊断：{p.depth?'关联人物页':'账号页'} · {states[p.state]||p.state}</summary><p>{p.url} · {p.reason}</p>
        {p.parentUrl&&<p>来自：{p.parentUrl}；仅证明公开链接关联，任职关系须核实。</p>}
        {p.navigation&&<p>正文HTTP {p.navigation.httpStatus} · {p.navigation.contentType} · 最终地址 {p.navigation.finalUrl}</p>}
        {p.robotsEvidence?.response?.attempts?.map((a:any,n:number)=><p key={n}>规则响应：HTTP {a.status??'未知'} · {a.contentType||'类型未知'} · {a.bytes??a.declaredBytes??'长度未知'} 字节 · {a.redirectTo||a.failure||p.robotsEvidence.failure}</p>)}
      </details>)}
      {!!job.page?.pausedSources?.length&&<p role="status">本批已暂停来源：{job.page.pausedSources.join('、')}。重复运行沿用暂停记录；尚未读取的平台保留为未覆盖，需要可用的公开入口后继续。</p>}
      {job.fresh&&(job.images?.length>0||anonymous&&job.page?.blocks?.length>0)&&<button disabled={busy||!available||job.analysisAttempted} onClick={()=>void perform('analyze',job.id)}>用 DeepSeek 整理新社媒文字与截图</button>}
      {job.page?.coverageRows&&<table aria-label="免登录平台覆盖"><thead><tr><th>平台</th><th>实际状态</th><th>新页面</th></tr></thead><tbody>{job.page.coverageRows.map((c:any)=><tr key={c.platform}><td>{c.platform}</td><td>{states[c.state]||c.state}</td><td>{c.newPages||0}</td></tr>)}</tbody></table>}
      <details><summary>公开搜索记录与摘要（仅为线索）</summary>{job.page?.searches?.map((s:any,i:number)=><article key={i}><p>{s.engine} · {s.query} · {states[s.state]||s.state} {s.reused?'复用':''}</p>{s.diagnostic&&<p>资料源检查：{s.diagnostic}</p>}{s.robotsEvidence&&<p><a href={s.robotsEvidence.url} target="_blank" rel="noreferrer">来源规则</a> · HTTP {s.robotsEvidence.status??'未知'} · {s.robotsEvidence.quote||s.reason}</p>}{s.results?.map((r:any)=><p key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.title||r.url}</a> · {r.snippet}</p>)}</article>)}</details>
      {job.images?.map((i:any)=><details key={i.imageId}><summary>查看社媒原始截图（须核对识别内容）</summary><img style={{maxWidth:'100%',height:'auto'}} alt={`${job.companyName}社媒原始截图`} src={`/api/v1/tenants/${tenantId}/contact-evidence?campaignId=${campaignId}&imageId=${i.imageId}`}/></details>)}
      <details><summary>浏览器实际操作记录</summary>{job.browser?.events?.map((e:any,n:number)=><p key={n}>{e.at} · {e.action} · {e.query||e.label||e.state||e.url||e.platform}</p>)}</details>
      <details><summary>本次新社媒原文</summary>{job.page?.blocks?.map((b:any)=><p key={b.id}>{b.text}</p>)}</details>
      {job.page?.diagnostic&&<details><summary>当前入口提示（未作为客户资料）</summary><p>{job.page.diagnostic.dialog||job.page.diagnostic.visibleExcerpt}</p></details>}
    </article>}
    <details><summary>本轮浏览器历史与缺项</summary>{view?.jobs?.map((j:any)=><p key={j.id}>{j.companyName} · {j.platform} · {states[j.state]||j.state} · {j.finishedAt||j.createdAt}</p>)}</details>
  </section>;
}
