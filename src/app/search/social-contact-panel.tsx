'use client';
import {useEffect,useState} from 'react';
import {contactPlatforms,platformCatalog} from '../../../scripts/research/platform-catalog.mjs';
import {ContactExecutionPanel} from './contact-execution-panel';
import {ContactReviewPanel} from './contact-review-panel';
import {ContactBatchPanel} from './contact-batch-panel';
import {BrowserContactPanel} from './browser-contact-panel';
import {CompanyPathPanel} from './company-path-panel';
import {OperatorBatchPanel} from './operator-batch-panel';
const errors:Record<string,string>={OWNER_REQUIRED:'只有企业负责人可以保存研究计划。',REQUEST_PENDING_OR_UNKNOWN:'有结果未知的请求，需先核对；未新增调用。',QUALIFIED_OFFICIAL_BUYER_REQUIRED:'请选择已核实官网与买方关系的企业。',CURRENT_COMPANY_ANALYSIS_REQUIRED:'缺少有效买方方向，请先检查企业分析。',SEARCH_BUSY_OR_RECOVERY_REQUIRED:'原任务正在处理，请稍后继续。',SEARCH_VERSION_CONFLICT:'资料已变化，请刷新后查看。'};
export function ContactResearchResult({plan}:{plan:any}){
  return <div aria-label="已保存社媒研究计划"><p>企业 {plan.counts.companies} 家 · 账号链接候选 {plan.counts.accounts} 个 · 官网联系渠道 {plan.counts.channels} 条 · 新关键人 {plan.counts.people} 人</p>
    <p>这份准备计划复用已有入口，外部调用 {plan.externalRequests} 次 · 发送 {plan.sent} 封。后续搜索与读取进度以第六步覆盖表为准。</p>
    {plan.blockers.map((b:string)=><p className="search-message" key={b}>{b}</p>)}
    {plan.companies.map((c:any)=><article className="discovery-evidence" key={c.companyId}><h3>{c.name}</h3>
      <p>采购权限及采购意愿：未确认。建议核实岗位：{c.roles.join('、')||'待企业分析补齐'}</p>
      <div className="platform-grid">{c.platformStates.map((s:any)=><div key={s.platform}><strong>{platformCatalog[s.platform].label}</strong><p>{s.notice}</p></div>)}</div>
      <details open><summary>官网指向的账号候选（{c.accounts.length}）</summary>{c.accounts.map((a:any)=><article key={a.url}>
        <a href={a.url} target="_blank" rel="noreferrer">{platformCatalog[a.platform].label} · {a.url}</a><p>{a.identityNotice}{a.sourceExpired?'；资料已过期，待核实':''}</p>
        {a.evidence.map((e:any)=><p key={e.id}>出处：<a href={e.sourceUrl} target="_blank" rel="noreferrer">{e.sourceUrl}</a> · {e.quote} · {e.retrievedAt}</p>)}
      </article>)}</details>
      <details><summary>已保存官网联系渠道（{c.channels.length}）</summary>{c.channels.map((r:any)=><p key={r.id}>{r.kind==='email'?'公共邮箱':r.kind==='phone'?(r.scope==='store'?'门店电话':'公司电话'):'联系页面'}：{r.value} · 可联系性和负责人待核实 · <a href={r.sourceUrl} target="_blank" rel="noreferrer">出处</a></p>)}</details>
      <details><summary>待执行的平台查询（{c.queries.length}）</summary>{c.queries.map((q:any)=><p key={q.platform}>{q.query} · 尚未发送</p>)}</details>
    </article>)}
  </div>;
}
export function SocialContactPanel({tenantId,campaignId,companies,owner,confirmedCompanyIds=[]}:{tenantId:string;campaignId:string;companies:any[];owner:boolean;confirmedCompanyIds?:string[]}){
  const eligible=companies.filter(c=>confirmedCompanyIds.includes(c.id)&&c.qualification?.status==='qualified');
  const [companyIds,setCompanyIds]=useState<string[]>([]),[platforms,setPlatforms]=useState<string[]>([...contactPlatforms]);
  useEffect(()=>{setCompanyIds(eligible.slice(0,20).map(c=>c.id));},[confirmedCompanyIds.join('|')]);
  const [plans,setPlans]=useState<any[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[message,setMessage]=useState('');
  const base=`/api/v1/tenants/${tenantId}/contact-research`,plan=plans.at(-1);
  useEffect(()=>{let live=true;void fetch(`${base}?campaignId=${campaignId}`).then(async r=>{
    if(!r.ok)throw Error('无法读取社媒研究记录，请检查企业权限。');const d=await r.json();if(live)setPlans(d.plans);
  }).catch(e=>{if(live)setMessage(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[base,campaignId]);
  const toggle=(values:string[],value:string)=>values.includes(value)?values.filter(v=>v!==value):[...values,value];
  async function prepare(){
    setBusy(true);setMessage('正在整理已保存官网账号与渠道');
    try{const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepare',campaignId,companyIds,platforms})}),d=await r.json();
      if(!r.ok)throw Error(errors[d.error]||'计划未保存，请检查权限、选择或刷新资料。');
      setPlans(old=>[...old.filter(p=>p.id!==d.plan.id),d.plan]);setMessage(d.reused?'已复用相同研究计划，没有新查询或模型调用。':'研究计划及保存的官网账号候选已入库；尚未执行新搜索。');
    }catch(e){setMessage(e instanceof Error?e.message:'未完成');}finally{setBusy(false);}
  }
  return <section className="search-panel social-contact-panel" aria-label="公司官网与社媒联系人研究" aria-busy={busy||loading}>
    <h2>公司官网与社媒联系人研究</h2><p>使用第五步确认的企业，整理官网链接和商务渠道，再按批次研究。旧资料继续保留。</p>
    <fieldset disabled={busy||loading||!owner}><legend>选择企业（每批最多20家）</legend><div className="contact-research-options">{eligible.map(c=><label key={c.id}><input type="checkbox" checked={companyIds.includes(c.id)} onChange={()=>setCompanyIds(toggle(companyIds,c.id))}/>{c.name}</label>)}</div></fieldset>
    <fieldset disabled={busy||loading||!owner}><legend>研究平台</legend><div className="contact-research-options">{Object.keys(platformCatalog).map(p=><label key={p}><input aria-label={`研究平台 ${platformCatalog[p].label}`} type="checkbox" checked={platforms.includes(p)} onChange={()=>setPlatforms(toggle(platforms,p))}/>{platformCatalog[p].label}</label>)}</div></fieldset>
    <p>整理研究计划只复用已保存资料，不产生新接口费用。真实批次的搜索、页面、模型上限与使用量在第六步分别显示。</p>
    <button disabled={busy||loading||!owner||!companyIds.length||companyIds.length>20||!platforms.length} onClick={()=>void prepare()}>研究官网与社媒联系人</button>
    {!confirmedCompanyIds.length&&<p>请先在企业初筛名单选择并确认要深入研究的企业。</p>}<p role="status">{message}</p>
    <OperatorBatchPanel tenantId={tenantId} campaignId={campaignId} owner={owner}/>
    <ContactBatchPanel tenantId={tenantId} campaignId={campaignId} platforms={platforms} owner={owner}/>
    <BrowserContactPanel tenantId={tenantId} campaignId={campaignId} companies={eligible} owner={owner}/>
    <CompanyPathPanel tenantId={tenantId} campaignId={campaignId} companies={eligible} owner={owner}/>
    {plan&&<><ContactResearchResult plan={plan}/><ContactExecutionPanel tenantId={tenantId} campaignId={campaignId} plan={plan} owner={owner}/></>}
    <ContactReviewPanel key={plan?.id||campaignId} tenantId={tenantId} campaignId={campaignId} owner={owner}/>
  </section>;
}
