'use client';
import {useEffect,useState} from 'react';
import './operator-batch.css';
import {OperatorFreeGrant} from './operator-free-grant';
import {OperatorDirectionResults} from './operator-direction-results';
import {ContactEnrichmentForm,ContactEnrichmentResults} from './contact-enrichment-panel';
import {OperatorCrmPanel} from './operator-crm-panel';
const messages:Record<string,string>={OPERATOR_SCOPE_EXPIRED_OR_DENIED:'本轮免费授权已到期，请保留进度，重新确认限额后再开新批次。',OPERATOR_GRANT_EXHAUSTED:'本轮免费次数已用完，历史资料和总表仍可查看。',OPERATOR_FREE_BALANCE_REQUIRED:'无法确认现有免费余额，已停止采集。',OPERATOR_SCOPE_UNAVAILABLE:'当前未配置有效的免费采集范围，请联系负责人确认。',OPERATOR_WINDOW_EXPIRED:'本批执行窗口已结束，未扩大额度或重发请求。'};
export function OperatorBatchPanel({tenantId,campaignId,owner}:{tenantId:string;campaignId:string;owner:boolean}){
  const [view,setView]=useState<any>(null),[companyIds,setCompanies]=useState<string[]>([]),[finder,setFinder]=useState(4),[verify,setVerify]=useState(2),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[filter,setFilter]=useState('全部');
  const [chosenBatch,setChosenBatch]=useState('');
  const base=`/api/v1/tenants/${tenantId}/operator-batches`,latest=view?.batches?.at(-1),batch=view?.batches?.find((b:any)=>b.id===chosenBatch)||latest,active=latest&&!['done','blocked'].includes(latest.state);
  async function load(){const r=await fetch(`${base}?campaignId=${campaignId}`,{cache:'no-store'}),data=await r.json();if(!r.ok)throw Error(messages[data.error]||'批次读取失败，请稍后刷新。');setView(data);return data;}
  useEffect(()=>{let live=true;const refresh=async()=>{try{const data=await load();if(live)setCompanies(old=>old.length?old:data.companies.map((c:any)=>c.id));}catch(e){if(live)setMessage((e as Error).message);}};void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>{live=false;clearInterval(timer);};},[base,campaignId]);
  useEffect(()=>{if(batch?.state==='done'){setMessage('本批资料和总表已保存，可筛选结果并下载。');window.dispatchEvent(new Event('contact-batch-updated'));}},[batch?.state,batch?.id]);
  useEffect(()=>{if(view?.scopeId){setFinder(view.limits.finder);setVerify(view.limits.verify);}},[view?.scopeId]);
  async function act(action:string,extra:any={}){
    setBusy(true);setMessage('正在保存批次操作…');
    try{const r=await fetch(base+(action==='authorize_enrichment'&&extra.grant?.method==='trace_v2'?'/trace':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaignId,action,...(action==='create'?{companyIds,finder,verify}:['authorize','authorize_enrichment'].includes(action)?{}:batch?{batchId:batch.id}:{}),...extra})}),data=await r.json();if(!r.ok)throw Error(messages[data.error]||'操作未完成，请刷新后查看已保存进度。');setView(data);if(['authorize','authorize_enrichment'].includes(action))setChosenBatch('');setMessage(action==='refresh_export'?(data.batches?.find((b:any)=>b.id===batch?.id)?.state==='done'?'总表已更新，可下载；没有新增查询。':'正在使用已保存资料更新总表，不新增查询。'):['create','authorize','authorize_enrichment'].includes(action)?'批次已保存，正在核对免费余额。':action==='confirm'||action==='select'?'已开始自动执行，可离开本页后回来查看。':action==='pause'?'已申请暂停，当前请求保存回执后停止。':'已从保存位置继续。');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  const people=(batch?.people||[]).filter((p:any)=>filter==='全部'||p.status===filter),statuses=[...new Set<string>((batch?.people||[]).map((p:any)=>p.status))];
  const noFreeSource=batch?.state==='confirm'&&batch.mode!=='people_enrichment'&&batch.accounts?.prospeo?.remaining===0;
  return <section id="operator-batch" className="search-panel operator-batch" aria-label="运营一键跑批" aria-busy={busy}>
    <div className="operator-heading"><div><h2>查找进度与结果</h2><p>先核对额度，再选企业查联系人；审核后加入客户库。</p></div><span className="operator-free">现金支出 ¥0 · 暂不发信</span></div>
    {view?.selfService&&<ContactEnrichmentForm view={view} busy={busy} owner={owner} active={!!active} onAuthorize={value=>void act('authorize_enrichment',value)}/>}
    {view?.selfService&&!active&&(view.batches.some((b:any)=>b.selfService&&b.state==='done'&&b.people?.length)?<details><summary>继续采集新企业（可选）</summary><OperatorFreeGrant busy={busy} owner={owner} onAuthorize={grant=>void act('authorize',{grant})}/></details>:<OperatorFreeGrant busy={busy} owner={owner} onAuthorize={grant=>void act('authorize',{grant})}/>)}
    {!view?.selfService&&<fieldset disabled={busy||!owner||!!active||!view?.available}><legend>本批采集范围</legend>
      <div className="operator-options">{view?.companies.map((c:any)=><label key={c.id}><input type="checkbox" checked={companyIds.includes(c.id)} onChange={()=>setCompanies(old=>old.includes(c.id)?old.filter(id=>id!==c.id):[...old,c.id])}/>{c.name}</label>)}</div>
      <div className="operator-options"><label>最多补邮箱人数<input aria-label="最多补邮箱人数" type="number" min="0" max={view?.limits.finder||0} value={finder} onChange={e=>setFinder(Number(e.target.value))}/></label><label>最多验证新邮箱<input aria-label="最多验证新邮箱" type="number" min="0" max={view?.limits.verify||0} value={verify} onChange={e=>setVerify(Number(e.target.value))}/></label></div>
      <p>{view?.mode==='saved_unqueried'?`仅补查已保存且未查询的联系人，当前可补查 ${view.unqueriedCount} 人，不采集新页。`:'每家读取下一未查页。'}本轮最多 {view?.limits.pages||0} 页、{view?.limits.finder||0} 人补邮箱、{view?.limits.verify||0} 个新邮箱验证。重复人物和已有邮箱验证自动复用。</p>
      {view?.credits&&<p>现有免费积分上限：Prospeo {view.credits.prospeo}，Hunter {view.credits.hunter}；未找到不扣积分，未知结果继续预留。</p>}
      <button disabled={!companyIds.length||!!active||(view?.usage.accounts||0)+4>(view?.limits.accounts||0)} onClick={()=>void act('create')}>创建免费采集批次</button>
    </fieldset>}
    <p role="status" aria-live="polite">{message}</p>
    {batch&&<div className="operator-result">
      {view?.batches.length>1&&<label>查看批次<select value={batch.id} onChange={e=>{setChosenBatch(e.target.value);setFilter('全部');}}>{view.batches.map((b:any)=><option value={b.id} key={b.id}>{new Date(b.createdAt).toLocaleString('zh-CN')} · {b.status}</option>)}</select></label>}
      <div className="operator-heading"><h3>{noFreeSource?'免费额度不足，尚未开始采集':batch.status}</h3></div>
      <div className="operator-summary" aria-label="本批实际结果"><div><span>企业候选</span><strong>{batch.companyChoices?.length??batch.targets?.length??0}</strong></div><div><span>已取得联系人</span><strong>{batch.people.length}</strong></div><div><span>邮箱候选（不等于已核实）</span><strong>{batch.people.filter((p:any)=>p.email).length}</strong></div></div>
      {noFreeSource&&<div className="operator-empty-credit" role="status"><strong>查找来源的免费余额为 0，本批无法开始。</strong><p>方向和历史已保存。免费额度恢复后，重新确认限额；如需购买额度，先由负责人批准。当前没有新增客户。</p><a href={`/contacts?tenantId=${tenantId}`}>先查看客户库与已有下载 →</a></div>}
      <details className="operator-audit"><summary>用量、免费余额与失败记录（失败／未知 {batch.failures} 次）</summary>
      <p>已用：采集 {batch.usage.pages} 页 · 补邮箱 {batch.usage.finder} 次 · 验证 {batch.usage.verify} 次 · 核额 {batch.usage.accounts} 次</p>
      {batch.creditLimits&&<p>积分已用或预留：Prospeo {batch.creditsReserved.prospeo}／{batch.creditLimits.prospeo}，Hunter {batch.creditsReserved.hunter}／{batch.creditLimits.hunter}。最终使用量以采集后账户余额为准。</p>}
      {batch.dailyLimit&&<p>每日请求参考余量 {batch.dailyLimit.remaining} 次（已保存回执）；本轮最新回执剩余 {batch.currentDailyRemaining??'尚待首条查询确认'}。次数不足会保留其余人物未查询。</p>}
      {batch.accounts&&<p>采集前免费余额：Prospeo {batch.accounts.prospeo?.remaining??'未确认'} 积分；Hunter {batch.accounts.hunter?.remaining??'未确认'} 积分。</p>}
      {batch.finalAccounts&&<p>采集后免费余额：Prospeo {batch.finalAccounts.prospeo?.remaining??'未确认'} 积分；Hunter {batch.finalAccounts.hunter?.remaining??'未确认'} 积分。</p>}
      </details>
      {batch.state==='confirm'&&!noFreeSource&&<div className="operator-confirm"><strong>核对本批范围，确认后开始</strong><p>{batch.mode==='people_enrichment'?`仅补全已保存的 ${batch.people.length} 人；公开搜索最多 ${batch.limits.searches} 次、正文读取最多 ${batch.limits.publicPages} 次、网页HTTP最多 ${batch.limits.network} 次；`:`最多查询 ${batch.limits.pages} 家企业的联系人、`}补邮箱最多 {batch.limits.finder} 人、验证最多 {batch.limits.verify} 个新邮箱。仅使用已核实的免费余额；不足自动缩减，无法确认免费则停止。执行最长60分钟，并受本轮授权截止时间限制。</p><button className="primary" disabled={busy||!owner||!view.available} onClick={()=>void act('confirm')}>确认免费限额并开始</button></div>}
      {['checking','running','exporting'].includes(batch.state)&&<button disabled={busy||!owner||batch.pauseRequested} onClick={()=>void act('pause')}>{batch.pauseRequested?'正在保存后暂停':'暂停本批'}</button>}
      {batch.state==='paused'&&<button disabled={busy||!owner} onClick={()=>void act('resume')}>从保存位置继续</button>}
      {batch.reason&&<p className="search-message">{messages[batch.reason]||batch.reason}</p>}
      {batch.selfService&&batch.mode!=='people_enrichment'&&!['checking','confirm'].includes(batch.state)&&<OperatorDirectionResults batch={batch} busy={busy} owner={owner} onSelect={companyIds=>void act('select',{companyIds})}/>}
      {batch.exportReady&&<a className="operator-download" href={`${base}?campaignId=${campaignId}&download=${batch.id}`}>{batch.selfService?'下载本批个人联系方式总表':'下载更新后的三家个人联系方式总表'}</a>}
      {batch.exportReady&&batch.scopeId===view?.scopeId&&<button disabled={busy||!owner} onClick={()=>void act('refresh_export')}>按已保存资料更新总表（不新增查询）</button>}
      {batch.mode==='people_enrichment'&&<ContactEnrichmentResults batch={batch}/>}
      {batch.state==='done'&&batch.people.length>0&&<OperatorCrmPanel key={batch.id} {...{tenantId,campaignId,owner}} batchId={batch.id}/>}
      {batch.mode!=='people_enrichment'&&<p>{view?.mode==='saved_unqueried'&&batch.scopeId===view.scopeId?'本批已保存联系人':'新采集人物'} {batch.people.length} 条；未找到或受限的资料会保留原因。邮箱技术有效与人物归属分开显示。</p>}
      {batch.mode!=='people_enrichment'&&!!batch.people.length&&<><label>查看处理结果<select aria-label="查看处理结果" value={filter} onChange={e=>setFilter(e.target.value)}><option>全部</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></label><div className="operator-table"><table><thead><tr><th>企业／姓名</th><th>处理结果</th><th>个人工作邮箱</th><th>个人主页</th><th>原因及下一步</th></tr></thead><tbody>{people.map((p:any)=><tr key={p.personKey}><td>{p.companyName}<br/><strong>{p.name}</strong></td><td>{p.status}</td><td>{p.email||'尚未取得'}</td><td>{p.profileUrl?<a href={p.profileUrl} target="_blank" rel="noreferrer">打开个人主页</a>:'未取得'}</td><td>{p.reason}</td></tr>)}</tbody></table></div></>}
      <details><summary>查看批次进度与历史（{view.batches.length} 批）</summary>{batch.events.map((e:any,i:number)=><p key={i}>{new Date(e.at).toLocaleTimeString('zh-CN')} {e.message}</p>)}{view.batches.slice(0,-1).map((b:any)=><p key={b.id}>{b.createdAt}：{b.status}，失败／未知 {b.failures} 次。</p>)}</details>
    </div>}
    {!view?.available&&view&&<p>{view.selfService?'在本页设置新的免费限额即可创建批次；历史结果继续保留。':'本轮授权窗口已结束。已保存的结果和总表仍可查看，新增采集需先确认新的免费限额。'}</p>}
  </section>;
}
