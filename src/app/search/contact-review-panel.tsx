'use client';
import {useEffect,useState} from 'react';
import {emailSelectable,type Judgment,type ReviewRow} from '@/domain/contact-review';
import './contact-review.css';
import {MarketingMailPanel} from './marketing-mail-panel';
import {ContactPersonDetails,ContactPersonChannels,ContactPath} from './contact-person-details';
import {PersonResearchPanel} from './person-research-panel';
import {ContactBatchResults} from './contact-batch-results';
const decisions={unreviewed:'未判断',keep:'保留',exclude:'排除',needs_info:'待补充'};
const relationships:Record<string,string>={unknown:'关系待核实',current_employee:'原文提到现职，当前任职待核实',founder:'原文提到创始人',former_employee:'历史任职',partner:'合作关系原文声明',mentioned:'人物提及，具体关联待核实'};
const scopes:Record<string,string>={company:'公司公共渠道',store:'门店渠道',person:'个人渠道候选，归属仍需核实',unknown:'渠道归属未知'};
const verification:Record<string,string>={unknown:'未知',unverified:'未验证',ownership_needs_review:'已公开，归属及有效性待核实',valid:'有验证依据',invalid:'无效',catch_all:'接收全部地址，个人邮箱待核实'};
const coverageStates:Record<string,string>={pending:'尚未完成',saved_partial:'已复用部分官网资料',blocked:'公开入口受限',read_partial:'已读取本批页面'};
const errors:Record<string,string>={CONTACT_REVIEW_STALE:'资料已变化，请刷新并重新判断受影响的记录。',OWNER_REQUIRED:'只有企业负责人可以保存判断。',CONTACT_JUDGMENT_REQUIRED:'请先判断至少一条资料。',CONTACT_EMAIL_SELECTION_INVALID:'只能选择保留的有效格式邮箱；公司邮箱与个人邮箱分别记录。',SEARCH_VERSION_CONFLICT:'其他操作更新了资料，请刷新后重试。'};
export function ContactReviewPanel({tenantId,campaignId,owner}:{tenantId:string;campaignId:string;owner:boolean}){
  const [data,setData]=useState<any>(null),[entries,setEntries]=useState<Record<string,Judgment>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [company,setCompany]=useState(''),[kind,setKind]=useState(''),[text,setText]=useState('');
  const base=`/api/v1/tenants/${tenantId}/contact-review`,view=data?.view;
  const adopt=(d:any)=>{setData(d);setEntries(Object.fromEntries(d.view.judgments.map((j:any)=>[j.rowId,{rowId:j.rowId,basisHash:j.basisHash,decision:j.decision,emailSelected:j.emailSelected,note:j.note}])));};
  const changes=view?.judgments.filter((j:any)=>{const e=entries[j.rowId];return e&&(j.stale||e.decision!==j.decision||e.emailSelected!==j.emailSelected||e.note!==j.note);}).map((j:any)=>entries[j.rowId])||[];
  const dirty=changes.length>0;
  useEffect(()=>{let live=true;setBusy(true);void fetch(`${base}?campaignId=${campaignId}`).then(async r=>{if(!r.ok)throw Error('无法读取联系人资料，请检查企业权限。');return r.json();})
    .then(d=>{if(live)adopt(d);}).catch(e=>{if(live)setMessage(e.message);}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[base,campaignId]);
  async function refresh(){setBusy(true);try{const r=await fetch(`${base}?campaignId=${campaignId}`);if(!r.ok)throw Error('资料读取失败，请稍后重试。');adopt(await r.json());setMessage('已读取数据库中保存的资料。');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  useEffect(()=>{const updated=()=>{if(dirty)setMessage('研究资料已更新；请先保存当前判断，再刷新资料。');else void refresh();};
    window.addEventListener('contact-batch-updated',updated);return()=>window.removeEventListener('contact-batch-updated',updated);},[base,campaignId,dirty]);
  function edit(id:string,patch:Partial<Judgment>){setEntries(old=>({...old,[id]:{...old[id],...patch}}));}
  async function submit(action:'save_judgments'|'confirm_review'|'finish_batch'){
    setBusy(true);try{const payload={action,campaignId,expectedTableHash:view.tableHash,...(action==='save_judgments'?{entries:changes}:action==='finish_batch'&&company?{companyIds:[company]}:{})};
      const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json();
      if(!r.ok)throw Error(errors[d.error]||'保存未完成，原判断仍保留在页面，请检查资料后重试。');adopt(d);
      setMessage(action==='finish_batch'?(d.reused?'本批已整理，复用上次保存结果，没有重复查询。':'本批结果已保存；缺项已逐人记录，没有重新查询。'):action==='save_judgments'?'判断已保存；原始人员关系和核实状态保留。':'名单已确认，邮件准备只包含你选中的邮箱。');
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  const rows:ReviewRow[]=(view?.rows||[]).filter((r:ReviewRow)=>(!company||r.companyId===company)&&(!kind||r.kind===kind)&&(!text||[r.companyName,r.name,r.title,r.value,r.employerClaim,...(r.careerHistory||[]).flatMap(j=>[j.employer,j.title,j.period]),...(r.personChannels||[]).map(c=>c.value)].join(' ').toLowerCase().includes(text.toLowerCase())));
  return <section id="contact-review" className="contact-review" aria-label="联系人资料与用户判断" aria-busy={busy}>
    <h2>联系人资料与用户判断</h2><p>查看人物、现任与历史职位及公开联系路径，再由销售判断如何联系。前员工、合作方、其他地区和关系未知的人物均保留。</p>
    <p role="status">{message}</p>{view&&<>
      <p>已保存 {view.rows.filter((r:ReviewRow)=>r.kind==='person').length} 条人物资料、{view.rows.filter((r:ReviewRow)=>r.kind==='channel').length} 条联系渠道。表格可判断；平台资料仍有未完成或受限项。</p>
      <div className="contact-review-tools"><label>研究企业<select value={company} onChange={e=>setCompany(e.target.value)}><option value="">全部企业</option>{[...new Map(view.rows.map((r:ReviewRow)=>[r.companyId,r.companyName])).entries()].map(([id,name]:any)=><option key={id} value={id}>{name}</option>)}</select></label>
        <label>资料类型<select value={kind} onChange={e=>setKind(e.target.value)}><option value="">全部资料</option><option value="person">人员</option><option value="channel">联系渠道</option></select></label>
        <label>查找姓名或联系方式<input value={text} onChange={e=>setText(e.target.value)}/></label>
        <button disabled={busy||dirty} onClick={()=>void refresh()}>刷新已保存资料</button>
        <a href={`${base}?campaignId=${campaignId}&export=xlsx${company?`&companyId=${encodeURIComponent(company)}`:''}`} aria-disabled={busy||dirty}
          onClick={e=>{if(busy||dirty){e.preventDefault();setMessage(dirty?'请先保存联系人判断，再下载含最新判断的Excel。':'资料正在处理，请完成后下载。');}}}>下载中文Excel（{company?'当前企业':'全部企业'}）</a>
        {data.exportBundle&&<a href={`${base}?campaignId=${campaignId}&export=xlsx&bundle=${encodeURIComponent(JSON.stringify(data.exportBundle))}`} aria-disabled={busy||dirty} onClick={e=>{if(busy||dirty){e.preventDefault();setMessage('请先保存当前判断，资料处理完成后再下载总表。');}}}>下载三家个人联系方式总表</a>}
        <a href={`${base}?campaignId=${campaignId}&export=csv`}>导出全部联系人表</a>
      </div>
      <p>Excel包含所选企业的全部人物、公共渠道和完整来源；姓名和资料类型筛选仅影响页面。Excel判断是副本，正式联系名单请在此保存确认。</p>
      <ContactBatchResults summary={view.batchSummary} company={company} disabled={busy||dirty||!owner} onFinish={()=>void submit('finish_batch')}/>
      <details className="contact-review-history"><summary>查看来源、销售判断及历史补查</summary>
      <PersonResearchPanel tenantId={tenantId} campaignId={campaignId} rows={rows} owner={owner} dirty={dirty}/>
      <div className="contact-review-scroll"><table><caption>显示 {rows.length}／{view.rows.length} 条；过滤不会删除资料</caption>
        <thead><tr><th>研究企业／类型</th><th>姓名、职位与关系</th><th>公开联络资料</th><th>出处与核实状态</th><th>用户判断</th><th>拟联系邮箱</th></tr></thead>
        <tbody>{rows.map(r=>{const j=entries[r.id];return <tr key={r.id} data-row-id={r.id}>
          <td data-label="研究企业／类型">{r.companyName}<br/>{r.kind==='person'?'人员':r.scope==='store'?'门店渠道':r.scope==='person'?'个人渠道':'公司渠道'}</td>
          <td data-label="姓名、职位与关系">{r.name||'公开渠道'}<br/>{r.title||'未取得职位'}<br/>{r.kind==='person'?relationships[r.relationship]||r.relationship:''}
            {r.kind==='person'&&<ContactPersonDetails row={r}/>}</td>
          <td data-label="公开联络资料">{r.kind==='person'?<ContactPersonChannels row={r}/>:<ContactPath kind={r.channelKind} value={r.value}/>}</td>
          <td data-label="出处与核实状态"><p>{r.kind==='person'?r.employerVerified?'任职有依据；经历时间分别记录':'身份、关联及任职时间待核实；保留给销售判断':`归属：${scopes[r.scope]||r.scope}；可用性：${verification[r.verification]||r.verification}`}</p>
            {r.kind==='person'&&<details><summary>合作补充标签</summary><p>采购权限：{r.purchaseAuthority==='evidenced'?'有依据':'未知'}。不影响人物收集或保留。</p></details>}
            <details><summary>查看 {r.evidence.length} 条依据</summary>{r.evidence.map((e,i)=><p key={i}><a href={e.sourceUrl} target="_blank" rel="noreferrer">来源</a> · 发布：{e.publishedAt||'未知'} · 获取：{e.retrievedAt||'未知'}<br/>{e.quote}</p>)}</details></td>
          <td data-label="用户判断"><select aria-label={`判断 ${r.id}`} value={j?.decision||'unreviewed'} disabled={busy||!owner} onChange={e=>edit(r.id,{decision:e.target.value as Judgment['decision'],...(e.target.value!=='keep'?{emailSelected:false}:{})})}>
            {Object.entries(decisions).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
            <input aria-label={`备注 ${r.id}`} placeholder="判断备注" value={j?.note||''} maxLength={1000} disabled={busy||!owner} onChange={e=>edit(r.id,{note:e.target.value})}/></td>
          <td data-label="拟联系邮箱">{emailSelectable(r)?<label><input type="checkbox" aria-label={`拟联系 ${r.email}`} checked={!!j?.emailSelected} disabled={busy||!owner} onChange={e=>edit(r.id,{emailSelected:e.target.checked,...(e.target.checked?{decision:'keep'}:{})})}/>选择 {r.scope==='person'?'个人':'公共'}邮箱</label>:<span>尚无可选邮箱</span>}</td>
        </tr>;})}</tbody></table></div>
      {!rows.length&&<p>当前筛选没有资料；可以查看全部企业或调整关键词。</p>}
      <p>拟联系 {Object.values(entries).filter(j=>j.emailSelected).length} 个邮箱。未判断和未选中的资料继续保留。</p>
      <button disabled={busy||!owner||!dirty} onClick={()=>void submit('save_judgments')}>保存联系人判断</button>{dirty&&<p>请先保存判断，再确认邮件名单。</p>}
      <button disabled={busy||!owner||dirty||!view.judgments.some((j:any)=>j.decision!=='unreviewed')} onClick={()=>void submit('confirm_review')}>确认名单并准备邮件</button>
      <details><summary>平台采集覆盖与缺项</summary>{view.coverage.map((c:any)=><p key={c.companyId+c.platform}>{c.companyName} · {c.platform} · {coverageStates[c.state]||c.state} · {c.notice}</p>)}</details>
      <details><summary>下一批精准查询（尚未发送）</summary><p>{data.queryPlan?.notice}</p>{data.queryPlan?.queries.map((q:any,i:number)=><p key={i}>{q.companyName} · {q.query} · {q.purpose} · {q.status}</p>)}</details>
      {data.handoff&&<article aria-label="已确认邮件名单"><h3>邮件准备</h3><p>{data.handoff.superseded?'资料或判断有变化，请重新确认。':'使用已确认的联系人选择。'}发送 {data.handoff.sent} 封。</p>
        {data.handoff.recipients.map((r:any)=><details key={r.rowId} open><summary>{r.companyName} → {r.email}</summary><p>{r.notice}</p><p>主题：{r.subject||'待准备'}</p><pre>{r.body||'尚无可复用草稿'}</pre></details>)}
        {data.handoff.blockers.map((b:string)=><p key={b}>{b}</p>)}<p>完成邮箱连接、内容审核与发送范围确认后，才能进入真实发送。</p>
      </article>}
      {data.handoff&&!data.handoff.superseded&&<MarketingMailPanel tenantId={tenantId} campaignId={campaignId} handoff={data.handoff} owner={owner}/>}
      </details>
    </>}{!view&&!busy&&<p>联系人资料尚未读取成功，可刷新页面恢复。</p>}
  </section>;
}
