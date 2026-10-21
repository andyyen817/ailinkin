'use client';
import {useState} from 'react';
import {relatedPageChoices} from '@/domain/shortlist-related-page';
export function ShortlistPanel({view,entities,busy,owner,onRun}:{view:any;entities:any[];busy:boolean;owner:boolean;onRun:(id?:string,source?:string,url?:string)=>void}){
  const [target,setTarget]=useState('');
  const [source,setSource]=useState('health');
  const [page,setPage]=useState('');
  const selected=entities.find(e=>e.id===target);
  const related=relatedPageChoices(selected);
  const candidates=selected?.resolution?.provider==='apollo'?selected.resolution.hits||[]:[];
  if(!view)return null;
  const stages:Record<string,string>={discover:'搜索买方业务',prepare:'整理已保存来源',extract:'识别独立企业',resolve:'定位企业官网','read-sites':'读取官网与相关页面','verify-batch':'核实身份、当地经营及适配'};
  return <section className="search-panel" aria-label="搜索并初筛企业"><h2>第二模块：搜索并初筛企业</h2>
    <p>按照企业与市场报告寻找买家，复用历史资料后核实官网。完成后在下方初筛表选择值得深入研究的企业。</p>
    <p role="status">{view.message}</p><p>来源 {view.sources} 条 · 企业线索 {view.entities} 家 · 有适配依据 {view.qualified} 家</p>
    <p>下一阶段：{stages[view.next]||'本轮范围已处理，请查看名单和未覆盖项'}</p>
    <label>优先核实企业<select aria-label="优先核实企业" disabled={busy} value={target} onChange={e=>setTarget(e.target.value)}><option value="">按系统顺序整批处理</option>{[...new Map([...entities.filter((e:any)=>e.role==='potential_buyer'),...(view.knownEntries||[])].map((e:any)=>[e.id,e])).values()].map((e:any)=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    {target&&<p>先定位或读取这家企业的官网资料；回到整批处理后统一核实，不立即增加模型调用。</p>}
    {view.alternatives&&<label>本轮资料来源<select aria-label="本轮资料来源" value={source} disabled={busy} onChange={e=>setSource(e.target.value)}><option value="health">{view.resumeOnly?'复用已保存的Apollo连接检查':'检查Apollo连接'}</option><option value="apollo">{view.resumeOnly?'恢复未发送的企业官网查询':'Apollo定位企业官网'}</option>{!view.resumeOnly&&<><option value="Bing">Bing匿名浏览器定位</option><option value="Google">Google匿名浏览器定位</option></>}<option value="read">读取已保存的官网入口</option><option value="verify">核实已读取的企业资料</option></select></label>}
    {view.accessChecks?.length>0&&<p>连接检查：{view.accessChecks.at(-1).message}</p>}
    {view.alternatives&&source==='read'&&candidates.length>1&&<label>候选官网<select aria-label="候选官网" value={candidates.some((h:any)=>h.url===page)?page:''} disabled={busy} onChange={e=>setPage(e.target.value)}><option value="">当前官网入口（归属待核实）</option>{candidates.map((h:any)=><option key={h.url} value={h.url}>{h.declaredName} · {h.url}</option>)}</select></label>}
    {view.alternatives&&source==='read'&&related.length>0&&<label>补充官网页面<select aria-label="补充官网页面" value={related.includes(page)?page:''} disabled={busy} onChange={e=>setPage(e.target.value)}><option value="">已保存官网入口</option>{related.map((url:string)=><option key={url} value={url}>{url}</option>)}</select></label>}
    <button disabled={busy||!owner||!view.available} onClick={()=>onRun(target||undefined,view.alternatives?source:undefined,source==='read'&&(related.includes(page)||candidates.some((h:any)=>h.url===page))?page:undefined)}>搜索并初筛企业</button>
    {!view.available&&<p>当前任务没有可执行的批次额度；已保存资料仍可查看和选择。</p>}
    {view.coverage&&<p>已尝试 {view.coverage.attemptedGroups}／{view.coverage.totalGroups} 个搜索组。{view.coverage.stopReason||'按本轮范围继续搜索与核实。'} 市场总量未知。</p>}
  </section>;
}
