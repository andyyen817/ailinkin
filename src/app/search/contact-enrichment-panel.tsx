'use client';
import {useState,type FormEvent} from 'react';
import {ContactTraceForm} from './contact-trace-form';
import {emailContactState} from '@/server/personal-contact-summary';
import {traceContactSummary} from '@/server/contact-trace-results';
export function ContactEnrichmentForm({view,busy,owner,active,onAuthorize}:{view:any;busy:boolean;owner:boolean;active:boolean;onAuthorize:(value:any)=>void}){
  const sources=(view?.batches||[]).filter((b:any)=>b.mode!=='people_enrichment'&&b.state==='done'&&b.people.length>0&&b.people.length<=49);
  const [selected,setSelected]=useState('');if(!sources.length)return null;
  const source=sources.find((b:any)=>b.id===selected)||sources.at(-1);
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget),number=(k:string)=>Number(data.get(k));onAuthorize({sourceBatchId:source.id,grant:{searches:number('searches'),publicPages:number('publicPages'),network:number('network'),finder:number('finder'),verify:number('verify'),prospeoCredits:number('prospeoCredits'),hunterCredits:number('hunterCredits'),minutes:number('minutes'),consent:data.has('consent')}});}
  return <section aria-label="批量补全联系人"><ContactTraceForm {...{view,busy,owner,active,onAuthorize}}/><details><summary>其他补全方式：首次查询工作邮箱</summary><h3>批量补全联系人</h3><p>沿用已保存人物，补查工作邮箱和本人其他社交账号。归属证据与邮箱技术验证分别保存；查不到继续下一位。</p>
    {!active&&<form onSubmit={submit} className="operator-confirm"><label>补全哪批联系人<select aria-label="补全哪批联系人" value={source.id} onChange={e=>setSelected(e.target.value)}>{sources.map((b:any)=><option value={b.id} key={b.id}>{new Date(b.createdAt).toLocaleString('zh-CN')} · {b.people.length}人</option>)}</select></label>
      <p>本次仅补全这 {source.people.length} 人，不采集新人；相同来源的历史结果直接复用，失败或结果未知的请求不自动重发。</p>
      <fieldset disabled={busy||!owner}><div className="operator-options">
        <label>公开搜索最多次数<input name="searches" type="number" min="0" max="49" defaultValue="49" required/></label>
        <label>网页读取上限（含免费核查）<input name="publicPages" type="number" min="0" max="98" defaultValue="98" required/></label>
        <label>网页HTTP总上限<input name="network" type="number" min="0" max="200" defaultValue="200" required/></label>
        <label>最多补邮箱人数<input name="finder" type="number" min="0" max="49" defaultValue="49" required/></label>
        <label>最多验证新邮箱<input name="verify" type="number" min="0" max="20" defaultValue="20" required/></label>
        <label>Prospeo免费积分上限<input name="prospeoCredits" type="number" min="0" max="24" defaultValue="24" required/></label>
        <label>Hunter免费积分上限<input name="hunterCredits" type="number" min="0" max="10" step="0.5" defaultValue="10" required/></label>
        <label>执行时间（分钟）<input name="minutes" type="number" min="5" max="60" defaultValue="60" required/></label>
      </div><label><input name="consent" type="checkbox" required/>我确认仅用现有免费来源和余额，现金0，不发信、不购买、不查手机；不足自动缩减。</label>
        <button disabled={busy||!owner}>核实免费额度，创建补全批次</button></fieldset>
    </form>}
  </details></section>;
}
export function ContactEnrichmentResults({batch}:{batch:any}){
  if(batch?.mode!=='people_enrichment')return null;
  const people=batch.people||[],owned=people.filter((p:any)=>p.emailCandidates?.some((c:any)=>c.confirmed)),social=people.filter((p:any)=>p.otherAccounts?.some((a:any)=>a.confirmed));
  const currentSummary=traceContactSummary(people);
  return <section aria-label="联系人补全结果"><h3>联系人补全结果</h3>
    <p>已处理 {people.filter((p:any)=>p.enrichmentComplete).length}／{people.length} 人 · 取得邮箱 {people.filter((p:any)=>p.email).length} 人 · 公开证据已确认邮箱归属 {owned.length} 人 · 已确认其他账号 {social.length} 人</p>
    <p>独立技术验证当前有效 {currentSummary.validEmails} 人；过期、处理中和缺少有效日期均不计入。</p>
    <p>公开搜索 {batch.usage.searches} 次；网页读取 {batch.usage.publicPages} 次；网页HTTP {batch.usage.network} 次。复用结果不计为新请求。</p>
    {batch.publicQualification&&<p>公开搜索来源：{batch.publicQualification.free?'官方免费条件已核实':'免费条件未核实，已停用'}。{batch.publicQualification.notice||batch.publicQualification.reason}</p>}
    <div className="operator-table"><table><thead><tr><th>企业／姓名</th><th>工作邮箱／归属</th><th>本人其他社交账号</th><th>归属证据</th><th>处理结果及原因</th></tr></thead><tbody>{people.map((p:any)=>{
      const evidence=[...(p.ownershipEvidence||[]),...(p.emailCandidates||[]).flatMap((c:any)=>c.evidence||[])];
      return <tr key={p.personKey}><td>{p.companyName}<br/><strong>{p.name}</strong><br/>{p.title}<br/><a href={p.profileUrl} target="_blank" rel="noreferrer">LinkedIn主页</a></td>
        <td>{p.email||'尚未取得'}<p>{p.ownershipState||'归属尚未核实'}</p><p>{p.email?emailContactState(p):''}</p></td>
        <td>{p.otherAccounts?.length?p.otherAccounts.map((a:any,i:number)=><p key={i}><a href={a.value} target="_blank" rel="noreferrer">{new URL(a.value).hostname} 账号</a><br/>{a.confirmed?'已核实属于本人':'候选，归属待核'}</p>):'本轮尚未取得'}</td>
        <td>{evidence.length?<details><summary>查看归属证据（{evidence.length}条）</summary>{evidence.map((e:any,i:number)=><div key={i}><a href={e.sourceUrl} target="_blank" rel="noreferrer">打开来源</a><p>{e.sourceType==='provider_receipt'?'供应商将此邮箱关联到已保存人员ID及主页；仍需公开证据复核。':e.quote.slice(0,600)}</p><small>{e.retrievedAt}</small></div>)}</details>:'暂未取得归属证据'}{!!p.publicChecks?.length&&<details><summary>查看已检查网页</summary>{p.publicChecks.map((c:any,i:number)=><p key={i}><a href={c.url} target="_blank" rel="noreferrer">打开检查来源</a><br/>{c.state==='read'?'已读取正文；归属以证据为准':c.reason}</p>)}</details>}</td>
        <td><strong>{p.status}</strong><p>{p.reason}</p></td></tr>;
    })}</tbody></table></div>
  </section>;
}
