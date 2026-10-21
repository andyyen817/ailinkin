'use client';
import {competitorRoleLabel} from '@/domain/competitor-role-label';
import {useEffect,useState} from 'react';
import {targetMarkets} from '@/domain/target-markets';
import './market-research.css';
import {MarketPlanView} from './market-plan-view';
import {MARKET_SCHEMA_ERROR,MARKET_SCHEMA_MESSAGE,MARKET_INCOMPLETE_MESSAGE} from '@/domain/market-model-output';
export function MarketResearchPanel({tenantId,analysisId,version,market,owner,onPlan}:{tenantId:string;analysisId:string;version:number;market:string;owner:boolean;onPlan?:(id:string,market:string)=>void}){
  const [entries,setEntries]=useState<any[]>([]),[execution,setExecution]=useState<any[]>([]),[chosen,setChosen]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const markets=targetMarkets(market),selected=markets.includes(chosen)?chosen:markets[0]||'',base=`/api/v1/tenants/${tenantId}/market-research`;
  const current=entries.find(e=>e.market===selected),scope=execution.find(e=>e.market===selected);
  useEffect(()=>{let live=true;void fetch(`${base}?analysisId=${analysisId}`).then(async r=>{if(!r.ok)throw Error('无法读取目标市场资料');return r.json();}).then(d=>{if(live){setEntries(d.entries);setExecution(d.execution);}}).catch(e=>{if(live)setMessage(e.message);});return()=>{live=false;};},[base,analysisId]);
  async function perform(action:'prepare'|'collect'|'run'){
    setBusy(true);setMessage(action==='prepare'?'正在复用企业资料和相关搜索历史':action==='collect'?'正在收集市场来源，本步不调用模型':'正在根据保存的来源生成报告');
    try{const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,analysisId,expectedVersion:version,market:selected})}),d=await r.json();
      if(!r.ok)throw Error(d.message|| (d.error==='MARKET_MODEL_INCOMPLETE'?MARKET_INCOMPLETE_MESSAGE:d.error===MARKET_SCHEMA_ERROR?MARKET_SCHEMA_MESSAGE:d.error==='MARKET_SCOPE_REQUIRED'?'本批真实市场研究额度未启用；没有新增调用。':d.error==='MARKET_BUSY_OR_UNKNOWN'?'已有处理中或结果未知的请求，请先核对记录。':'本步未完成，请查看保存记录；原结果保留。'));
      setEntries(old=>[...old.filter(e=>e.market!==d.snapshot.market),d.snapshot]);setExecution(old=>[...old.filter(e=>e.market!==d.snapshot.market),{market:d.snapshot.market,...d.execution}]);
      setMessage(action==='prepare'?'已复用并保存市场概览；没有新增搜索或模型调用。':action==='collect'?'市场来源已保存；本步模型调用为0，请查看来源后生成报告。':'市场分析结果与来源已保存，请查看仍待核实的部分。');
    }catch(e){setMessage((e as Error).message);try{const r=await fetch(`${base}?analysisId=${analysisId}`);if(r.ok){const d=await r.json();setEntries(d.entries);setExecution(d.execution);}}catch{}}
    finally{setBusy(false);}
  }
  function claim(c:any){return <div className="market-claim"><strong>{c.kind==='fact'?'来源事实':c.kind==='hypothesis'?'待验证推断':'未知'}</strong><p>{c.text}</p>
    {c.references.map((ref:any,i:number)=>{const source=current.sources.find((s:any)=>s.id===ref.sourceId);return <details key={i}><summary>查看依据</summary><p>{ref.quote}</p><p>{source?.url?<a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>:source?.title} · {source?.retrievedAt||'日期待核实'} · {source?.kind==='enterprise'?'企业提供的资料':'公开来源，事实含义仍需核对'}</p></details>;})}</div>;}
  return <section className="market-research" aria-label="目标市场分析与客户潜力" aria-busy={busy}>
    <h2>第一步：企业×目标市场拓客计划</h2><p>根据企业能力和目标市场比较买家、渠道、竞争对手与产品／服务条件。拓展意愿不代表已具备当地交付能力。</p>
    <label>分析市场<select aria-label="市场概览国家" value={selected} onChange={e=>setChosen(e.target.value)} disabled={busy}>{markets.map(m=><option key={m}>{m}</option>)}</select></label>
    <button disabled={busy||!owner||!selected} onClick={()=>void perform('prepare')}>整理完整拓客计划（复用资料）</button>
    <button disabled={busy||!owner||!current||!scope?.enabled} onClick={()=>void perform('collect')}>收集已确认的市场资料</button>
    <button disabled={busy||!owner||!current||!scope?.enabled} onClick={()=>void perform('run')}>按已确认额度更新市场分析</button>
    <p role="status">{message}</p><p>{scope?.notice||'真实市场搜索和模型额度未启用，仍可整理已保存资料。'}</p>
    {current&&<><p>{current.reportOrigin==='deepseek_flash'?'已保存的本市场模型报告':'复用既有企业分析；竞争与市场条件尚未完成新模型研究'}{current.reportPending?'；有新来源待分析':''}</p><p>{current.report.summary}</p>
      {current.message&&<p>本步记录：{current.message==='MARKET_MODEL_INCOMPLETE'?MARKET_INCOMPLETE_MESSAGE:[MARKET_SCHEMA_ERROR,'MARKET_REPORT_STRUCTURE_INVALID'].includes(current.message)?MARKET_SCHEMA_MESSAGE:current.message}</p>}{current.modelSourceCoverage&&<p>本次分析使用 {current.modelSourceCoverage.selectedSources} / {current.modelSourceCoverage.relevantSources} 份相关资料；未纳入或截取的完整原文仍保存，结论只覆盖所选资料。</p>}
      {current.reportReview?.partial&&<details><summary>有 {current.reportReview.rejected.length} 项建议尚未通过依据检查</summary><p>{current.reportReview.notice}</p>{current.reportReview.rejected.map((r:any,i:number)=><p key={i}>{r.original.text||r.original.name||r.original.dimension} · 原始内容已保留，未作为已核实结论。</p>)}</details>}
      <MarketPlanView snapshot={current} busy={busy||!owner} onPlan={onPlan} claim={claim}/>
      <div className="market-columns"><section><h3>建议客户</h3>{current.report.buyers.map((c:any,i:number)=><article key={i}>{claim(c)}</article>)}</section>
        <section><h3>合作渠道</h3>{current.report.channels.length?current.report.channels.map((c:any,i:number)=><article key={i}>{claim(c)}</article>):<p>暂无有依据的渠道建议，保留待研究。</p>}</section></div>
      <h3>我方竞争者与替代方案</h3>{current.report.competitors.length?current.report.competitors.map((c:any,i:number)=><article key={i}><h4>{c.name}</h4><p>与我方关系：{competitorRoleLabel(c.role)}</p><p>{c.market} · {c.presence?.status==='local_evidence'?'当地经营有正文证据':c.presence?.status==='export_only'?'仅出口线索':'当地经营待核实'}</p>{c.website&&<a href={c.website} target="_blank" rel="noreferrer">已观察的来源网站</a>}{[...c.claims,...c.presence?[c.presence.evidence]:[],...c.products||[],...c.prices||[],...c.services||[]].map((v:any,j:number)=><div key={j}>{claim(v)}</div>)}</article>):<p>尚未取得可引用的竞争对手资料，不能写成市场没有竞争者。</p>}
      <h3>产品与服务竞争力</h3>{current.report.competitiveness.length?current.report.competitiveness.map((c:any,i:number)=><article key={i}><h4>{c.dimension}</h4>{claim(c.ourPosition)}{claim(c.marketRequirement)}{claim(c.assessment)}</article>):<p>企业能力已有资料；当地竞品、价格和服务要求尚不足以支持竞争力结论。</p>}
      <h3>客户潜力与后续搜索覆盖</h3><p>市场总客户数量：{current.counts.marketTotal??'暂无法可靠估计'}。已发现名单是当前下限，采购意愿仍待确认。</p>
      <div className="market-counts"><p>已发现独立企业 <strong>{current.counts.candidateOrganizations}</strong></p><p>有适配依据 <strong>{current.counts.qualifiedOrganizations}</strong></p><p>待核实 <strong>{current.counts.pendingOrganizations}</strong></p><p>暂不适配 <strong>{current.counts.unfitOrganizations}</strong></p></div>
      <p>复用公开资料 {current.sourcesReused} 份。市场调查所得企业和来源继续用于客户搜索。</p>
      {current.groups.map((g:any)=><article key={g.key}><strong>{g.label}</strong><p>{g.status} · 已记录 {g.attemptedBatches} 批；不代表整个市场已搜尽。</p><p>{g.queries.join(' / ')}</p></article>)}
      <h3>未知与下一步</h3>{[...current.report.unknowns,...current.report.nextActions].map((v:string,i:number)=><p key={i}>{v}</p>)}
      <p>本市场新增记录请求 {current.requests.length} 次；实际费用以供应商记录为准。</p>
    </>}
  </section>;
}
