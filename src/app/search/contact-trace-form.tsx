'use client';
import {useState,type FormEvent} from 'react';
export function ContactTraceForm({view,busy,owner,active,onAuthorize}:{view:any;busy:boolean;owner:boolean;active:boolean;onAuthorize:(value:any)=>void}){
  const sources=(view?.batches||[]).filter((b:any)=>b.mode!=='people_enrichment'&&b.state==='done'&&b.people.length>0&&b.people.length<=49);
  const [selected,setSelected]=useState(''),[person,setPerson]=useState(''),[alias,setAlias]=useState(''),[url,setUrl]=useState(''),[hints,setHints]=useState<any[]>([]);
  const source=sources.find((b:any)=>b.id===selected)||sources.at(-1);if(!source||active)return null;
  function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const d=new FormData(e.currentTarget),n=(k:string)=>Number(d.get(k));onAuthorize({sourceBatchId:source.id,grant:{method:'trace_v2',searches:n('searches'),publicPages:n('publicPages'),network:n('network'),finder:0,verify:n('verify'),prospeoCredits:0,hunterCredits:n('hunterCredits'),minutes:n('minutes'),pdfs:n('pdfs'),pdfPages:10,pdfBytes:5242880,hints,consent:d.has('consent')}});}
  function addHint(){if(!person||(!alias.trim()&&!url.trim())||hints.length>=49)return;setHints(old=>[...old,{personKey:person,alias:alias.trim(),...(url.trim()?{url:url.trim()}:{})}]);setAlias('');setUrl('');}
  return <section aria-label="沿公开线索补全"><h3>沿公开线索补全联系人</h3><p>追查本人主页外链、其他平台和职业活动PDF。已有邮箱保留；只将有证据的资料标为本人所有，查不到继续下一位。</p>
    <form onSubmit={submit} className="operator-confirm"><fieldset disabled={busy||!owner}>
      <label>选择已保存的人物批次<select aria-label="选择已保存的人物批次" value={source.id} onChange={e=>{setSelected(e.target.value);setHints([]);setPerson('');}}>{sources.map((b:any)=><option key={b.id} value={b.id}>{new Date(b.createdAt).toLocaleString('zh-CN')} · {b.people.length}人</option>)}</select></label>
      <p>只处理这 {source.people.length} 人，不采新人，不重查旧邮箱，不重复请求失败或结果未知的来源。</p>
      <details><summary>添加已知别名或公开网址（可选）</summary><label>联系人<select value={person} onChange={e=>setPerson(e.target.value)}><option value="">请选择</option>{source.people.map((p:any)=><option key={p.personKey} value={p.personKey}>{p.name} · {p.companyName}</option>)}</select></label>
        <label>本人已使用的别名／当地姓名<input value={alias} maxLength={120} onChange={e=>setAlias(e.target.value)}/></label><label>已知的公开主页网址<input value={url} type="url" maxLength={1000} onChange={e=>setUrl(e.target.value)}/></label><button type="button" onClick={addHint}>添加这条线索</button>
        {hints.map((h,i)=><p key={i}>{source.people.find((p:any)=>p.personKey===h.personKey)?.name}：{h.alias} {h.url}<button type="button" onClick={()=>setHints(old=>old.filter((_,j)=>j!==i))}>移除</button></p>)}</details>
      <div className="operator-options">{[['searches','新公开搜索次数',98],['publicPages','网页／PDF读取次数',196],['network','含跳转和robots的HTTP总次数',500],['pdfs','PDF最多份数',20],['verify','仅验证新邮箱次数',20],['hunterCredits','Hunter现有免费积分',10],['minutes','采集分钟数',60]].map(([key,label,max])=><label key={key}>{label}<input name={String(key)} type="number" min={key==='minutes'?5:0} max={Number(max)} step={key==='hunterCredits'?0.5:1} defaultValue={max} required/></label>)}</div>
      <p>每份PDF最多10页、5MB；核额共最多4次。先核实免费条件及余额，不足缩减，无法确认免费就停用该来源。LinkedIn受限会保留原因，不绕过限制。</p>
      <label><input name="consent" type="checkbox" required/>我确认以上免费限额：现金0、不发信、不购买、不注册、不查手机；保留历史、失败及用量。</label>
      <button disabled={busy||!owner}>核实免费额度，创建线索追查批次</button>
    </fieldset></form></section>;
}
