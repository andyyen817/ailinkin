'use client';
import {useEffect,useState} from 'react';
import './enterprise-selection.css';
const labels:Record<string,string>={unreviewed:'未选择',research:'深入研究',exclude:'排除',needs_info:'待补资料'};
const statuses:Record<string,string>={qualified:'有适配依据',unfit:'暂不适配',pending:'待核实',other_role:'其他业务角色'};
export function EnterpriseSelectionPanel({tenantId,campaignId,owner,onConfirmed}:{tenantId:string;campaignId:string;owner:boolean;onConfirmed:(ids:string[])=>void}){
  const [view,setView]=useState<any>(null),[entries,setEntries]=useState<Record<string,any>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[text,setText]=useState(''),[status,setStatus]=useState('');
  const base=`/api/v1/tenants/${tenantId}/enterprise-selection`;
  function adopt(v:any){setView(v);setEntries(Object.fromEntries(v.decisions.map((d:any)=>[d.id,{id:d.id,basisHash:d.basisHash,decision:d.decision,note:d.note}])));onConfirmed(v.confirmation?.valid?v.selected:[]);}
  useEffect(()=>{let live=true;setBusy(true);void fetch(`${base}?campaignId=${campaignId}`).then(async r=>{if(!r.ok)throw Error('无法读取企业初筛名单');return r.json();}).then(v=>{if(live)adopt(v);}).catch(e=>{if(live)setMessage(e.message);}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[base,campaignId]);
  const changes=view?.decisions.filter((d:any)=>{const e=entries[d.id];return e&&(d.stale||e.decision!==d.decision||e.note!==d.note);}).map((d:any)=>entries[d.id])||[],dirty=changes.length>0;
  function edit(id:string,patch:any){setEntries(old=>({...old,[id]:{...old[id],...patch}}));}
  async function submit(action:'save'|'confirm'){
    setBusy(true);try{const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,campaignId,expectedBasis:view.basis,entries:changes})}),d=await r.json();
      if(!r.ok)throw Error(d.error==='ENTERPRISE_SELECTION_STALE'?'企业证据有变化，请刷新并重新选择受影响企业。':d.error==='ENTERPRISE_SELECTION_EMPTY'?'请选择至少一家要深入研究的企业。':'名单未保存，原选择仍保留，请稍后重试。');
      adopt(d.view);setMessage(action==='save'?'企业选择已保存。':'深度研究名单已确认；只有这份名单可以建立新研究批次。');window.dispatchEvent(new Event('enterprise-selection-updated'));
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  const rows=view?.rows.filter((r:any)=>(!status||r.status===status)&&(!text||[r.name,r.website,...r.reasons].join(' ').toLowerCase().includes(text.toLowerCase())))||[];
  return <section id="enterprise-shortlist" className="search-panel enterprise-selection" aria-label="目标企业初筛与深研选择" aria-busy={busy}>
    <h2>第四步：目标企业初筛名单</h2><p>查看身份、目标市场、适配理由和证据，再决定哪些企业值得深入研究。待核实与不适配资料继续保留。</p><p role="status">{message}</p>
    {view&&<><div className="enterprise-tools"><label>企业筛选<input aria-label="企业初筛搜索" value={text} onChange={e=>setText(e.target.value)}/></label>
      <label>初筛状态<select aria-label="企业初筛状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(statuses).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><a href={`${base}?campaignId=${campaignId}&export=csv`}>导出全部企业初筛名单</a></div>
      <div className="enterprise-scroll"><table><caption>显示 {rows.length}／{view.rows.length} 家；独立采购关系仍需核实</caption><thead><tr><th>企业／目标市场</th><th>官网与身份</th><th>初筛依据</th><th>深入研究选择</th></tr></thead>
        <tbody>{rows.map((r:any)=><tr key={r.id}><td data-label="企业／目标市场">{r.name}<p>{r.market}</p></td><td data-label="官网与身份">{r.website?<a href={r.website} target="_blank" rel="noreferrer">官网或候选网站</a>:'官网待定位'}<p>{r.identityVerified?'身份已有依据':'身份待核实'}</p></td>
          <td data-label="初筛依据"><strong>{statuses[r.status]||r.status}</strong><p>当地经营：{r.marketVerified?'有依据':'待核实'} · 买方业务：{r.buyerVerified?'有依据':'待核实'}</p>{r.reasons.map((v:string,i:number)=><p key={i}>{v}</p>)}{r.cooperationHypothesis&&<p>合作假设：{r.cooperationHypothesis}</p>}<p>待核实：{r.unknowns?.join('；')||'实际采购意愿、具体采购模式及产品条件仍需后续确认'}</p><details><summary>查看 {r.evidence.length} 条来源</summary>{r.evidence.map((e:any,i:number)=><p key={i}><a href={e.url||e.sourceUrl} target="_blank" rel="noreferrer">来源</a> · {e.quote||e.summary||'请核对原始资料'}</p>)}</details></td>
          <td data-label="深入研究选择"><label><input type="checkbox" aria-label={`深入研究选择 ${r.name}`} checked={entries[r.id]?.decision==='research'} disabled={busy||!owner} onChange={e=>edit(r.id,{decision:e.target.checked?'research':'unreviewed'})}/> 深入研究</label><select aria-label={`企业选择 ${r.name}`} value={entries[r.id]?.decision||'unreviewed'} disabled={busy||!owner} onChange={e=>edit(r.id,{decision:e.target.value})}>{Object.entries(labels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
            <input aria-label={`企业备注 ${r.name}`} placeholder="选择理由或待核实事项" maxLength={1000} value={entries[r.id]?.note||''} disabled={busy||!owner} onChange={e=>edit(r.id,{note:e.target.value})}/></td></tr>)}</tbody></table></div>
      <h2>第五步：确认深度研究名单</h2><p>选中 {Object.values(entries).filter((e:any)=>e.decision==='research').length} 家。选择不会改变企业身份、采购意愿或原始适配结论。</p>
      <button disabled={busy||!owner||!dirty} onClick={()=>void submit('save')}>保存企业选择</button>
      <button disabled={busy||!owner||dirty||!view.selected.length} onClick={()=>void submit('confirm')}>确认深度研究名单</button>
      {dirty&&<p>先保存当前选择，再确认名单。</p>}<p>{view.confirmation?.valid?'已确认名单可建立研究批次。':'尚未确认；不会默认研究全部企业。'}</p>
    </>}
  </section>;
}
