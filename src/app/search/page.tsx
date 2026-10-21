'use client';
import {useEffect,useRef,useState} from 'react';
import './search.css';
import {QualityPanel} from './quality-panel';
import {EntityPipelinePanel} from './entity-pipeline-panel';
import {ContactPackagePanel} from './contact-package-panel';
import {SocialContactPanel} from './social-contact-panel';
import {EnterpriseSelectionPanel} from './enterprise-selection-panel';
import {SevenStepNav} from './seven-step-nav';
import {ShortlistPanel} from './shortlist-panel';
type SearchRow={id:string;version:number;state:string;message:string;project:any;quality:any;sourcePipeline:any;milestone?:any;shortlist?:any;counts:{found:number;researched:number;contacts:number;requests:number;reservedUsd:number;reservedCredits?:number};batches:any[];companies:any[]};
type Connection={name:string;configured:boolean};
const stateNames:Record<string,string>={draft:'待开始',running:'正在执行',blocked:'等待处理',partial:'部分完成',complete:'当前任务标记完成，请核对有效数量'};
const safeLink=(url:string)=>/^https?:\/\//i.test(url||'')?url:undefined;
export default function SearchPage(){
  const [tenant,setTenant]=useState(''),[rows,setRows]=useState<SearchRow[]>([]),[selected,setSelected]=useState(''),[connections,setConnections]=useState<Connection[]>([]);
  const [owner,setOwner]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[loaded,setLoaded]=useState(false);
  const [deepSelected,setDeepSelected]=useState<string[]>([]);
  const continuing=useRef(false),mounted=useRef(true);
  const base=`/api/v1/tenants/${tenant}/research`,current=rows.find(r=>r.id===selected);
  function update(row:SearchRow){if(!mounted.current)return;setRows(old=>[row,...old.filter(r=>r.id!==row.id)]);setSelected(row.id);}
  function selectCampaign(id:string){
    setSelected(id);
    const url=new URL(location.href);url.searchParams.set('campaignId',id);
    history.replaceState(null,'',url);
  }
  async function load(id:string){
    const response=await fetch(`/api/v1/tenants/${id}/research`);
    if(response.status===401){location.assign('/login');return;}
    if(!response.ok)throw Error('无法读取搜索任务，请检查企业权限或联系管理员。');
    const data=await response.json();setRows(data.campaigns);setConnections(data.connections);setSelected(old=>old||new URLSearchParams(location.search).get('campaignId')||data.campaigns[0]?.id||'');setLoaded(true);
  }
  useEffect(()=>{mounted.current=true;const id=new URLSearchParams(location.search).get('tenantId')||'';setTenant(id);
    if(!id){setMessage('请先从企业工作台选择企业，再进入客户搜索。');return;}
    void (async()=>{const r=await fetch('/api/v1/me');if(r.status===401){location.assign('/login');return;}if(!r.ok)throw Error('账号暂时无法访问。');const me=await r.json();setOwner(me.memberships?.some((m:any)=>m.tenant_id===id&&m.role==='owner'));await load(id);})().catch(e=>setMessage(e.message));
    return()=>{mounted.current=false;continuing.current=false;};
  },[]);
  async function post(body:unknown){
    const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await r.json();
    const historyErrors:Record<string,string>={RELATED_SEARCH_ALREADY_RUNNING:'相关买家组正在搜索，请等其结束后继续，以便先排除新找到的客户。',HISTORY_SCOPE_UNAVAILABLE:'关联历史不可用，请回到企业分析页检查搜索计划。',EXCLUSION_CAPACITY_REQUIRES_REVIEW:'相关官网超过100个，请先细化买家范围，再继续网页搜索。',APOLLO_HISTORY_CHANGED:'相关名单新增了企业，旧Apollo分页条件已变化。当前已停止，请调整搜索计划后建立新任务。'};
    if(!r.ok)throw Error(historyErrors[data.error]||({OWNER_REQUIRED:'只有企业负责人可以启动采集。',SEARCH_BUSY_OR_RECOVERY_REQUIRED:'任务正在处理，或上次执行中断需要核对。请勿重复启动。',INVALID_INPUT:'请检查产品、地区、数量和预算。'} as Record<string,string>)[data.error]||'操作未完成，输入已保留，请稍后重试。');
    update(data.campaign);return data.campaign as SearchRow;
  }
  async function execute(row:SearchRow,stage='discover',entityId?:string,resolutionPlan?:string,renderEmptyHtml?:boolean,targetPageUrl?:string,alternativeSource?:string){
    continuing.current=true;let previous=row.counts.requests,revision=row.shortlist?.revision||0;
    do{
      const priorStage=row.sourcePipeline?.nextStage;row=await post({action:'run',id:row.id,stage,...(entityId?{entityId}:{}),...(resolutionPlan?{resolutionPlan}:{}),...(renderEmptyHtml?{renderEmptyHtml:true}:{}),...(targetPageUrl?{targetPageUrl}:{}),...(alternativeSource?{alternativeSource}:{})});
      if(stage==='shortlist'&&row.state==='partial'&&row.shortlist?.next&&row.shortlist.revision>revision){revision=row.shortlist.revision;continue;}
      if(stage==='shortlist')break;
      if(row.milestone?.reached)break;
      if(stage==='buyers'&&row.state==='partial'&&row.sourcePipeline?.nextStage&&(row.counts.requests>previous||priorStage!==row.sourcePipeline.nextStage)){previous=row.counts.requests;continue;}
      if(stage!=='discover'||row.state!=='partial'||row.counts.requests<=previous||!row.message.includes('可继续处理下一批'))break;
      previous=row.counts.requests;
    }while(continuing.current&&mounted.current);
  }
  async function resume(stage:string,entityId?:string,resolutionPlan?:string,renderEmptyHtml?:boolean,targetPageUrl?:string,alternativeSource?:string){if(!current||busy)return;setBusy(true);setMessage('');try{await execute(current,stage,entityId,resolutionPlan,renderEmptyHtml,targetPageUrl,alternativeSource);}catch(e){setMessage((e as Error).message);}finally{if(mounted.current)setBusy(false);continuing.current=false;}}
  return <main className="workspace search-page">
    <header><a className="brand" href="/workspace"><span className="brand-mark">L</span>企业工作台</a><nav><a href={`/profiles?tenantId=${tenant}`}>企业资料</a><a href={`/contacts?tenantId=${tenant}`}>客户库</a><a href="/workspace">切换企业</a></nav></header>
    <section className="workspace-intro"><span className="eyebrow">发现 · 研究 · 合作机会</span><h1>客户搜索</h1><p className="muted">按产品和市场发现候选企业，逐个平台记录资料，再审核联系方式与开发信。</p></section>
    {message&&<p className="form-message" role="alert">{message}</p>}
    {current&&<SevenStepNav tenantId={tenant} project={current.project} quality={current.quality} selectedCount={deepSelected.length}/>}
    <div className="search-layout"><aside>
      <section className="search-form search-panel"><h2>先让 AI 了解企业</h2>
        <p>提供业务、产品和能力，让 AI 推荐适合的买家，再选择市场与搜索额度。</p>
        <a className="primary" href={`/profiles?tenantId=${tenant}`}>填写企业资料并制定搜索计划</a>
        <a href={`/prospecting?tenantId=${tenant}`}>直接创建新方向，确认免费限额并采集</a>
        {!owner&&loaded&&<p>采集由企业负责人启动，成员可以查看结果。</p>}
        <small>已有任务可继续查看和研究；新搜索使用企业分析中已检查的客户方向。</small>
      </section>
      <section className="search-panel"><h2>来源接入状态</h2><ul className="source-list">{connections.map(c=><li key={c.name}><span>{c.name}</span><span className={c.configured?'source-ready':'source-missing'}>{c.configured?'已配置':'未配置'}</span></li>)}</ul><small>缺少接入时会保存任务并说明原因，实际采集量保持为 0。</small></section>
    </aside><section className="search-results">
      <div className="search-panel search-history"><label>搜索任务<select aria-label="搜索任务" value={selected} onChange={e=>{setDeepSelected([]);selectCampaign(e.target.value);}} disabled={busy}><option value="">选择任务</option>{rows.map(r=><option key={r.id} value={r.id}>{r.project.product} · {r.project.country} · {r.project.discoveryPolicy?.mode==='coverage'?`按覆盖搜索${r.project.discoveryPolicy.expectedTarget?'，期望'+r.project.discoveryPolicy.expectedTarget+'家':''}`:r.project.target+'家'}</option>)}</select></label><button disabled={busy||!tenant} onClick={()=>void load(tenant).catch(e=>setMessage(e.message))}>刷新进度</button></div>
      {current?<>
          <ShortlistPanel key={'shortlist-'+current.id} view={current.shortlist} entities={current.sourcePipeline?.entities||[]} busy={busy} owner={owner} onRun={(id,source,url)=>void resume('shortlist',id,undefined,undefined,url,source)}/>
        <EntityPipelinePanel pipeline={current.sourcePipeline} milestone={current.milestone} busy={busy} owner={owner} onRun={(stage,id,plan,render,url)=>void resume(stage,id,plan,render,url)}/>
        <QualityPanel project={current.project} quality={current.quality}/>
        <EnterpriseSelectionPanel key={'selection-'+current.id+'-'+current.version} tenantId={tenant} campaignId={current.id} owner={owner} onConfirmed={setDeepSelected}/>
        <ContactPackagePanel key={current.id} tenantId={tenant} campaignId={current.id} companies={current.companies} owner={owner}/>
        <SocialContactPanel key={'social-'+current.id} tenantId={tenant} campaignId={current.id} companies={current.companies} owner={owner} confirmedCompanyIds={deepSelected}/>
        <section className="search-panel"><div className="search-heading"><h2>{current.project.product} · {current.project.country}</h2><span className="badge">{stateNames[current.state]}</span></div><p className="search-message" role="status">{current.message||'任务已保存，等待开始。'}</p>
          <div className="search-actions"><button disabled={busy||!owner} onClick={()=>void resume('discover')}>继续搜索</button><button disabled={busy||!owner||!current.counts.found} onClick={()=>void resume('research')}>研究下一家</button><button disabled={busy||!owner||!current.counts.found} onClick={()=>void resume('analyze')}>生成分析与草稿</button><a href={`${base}?id=${current.id}&export=csv`}>导出 CSV</a>{busy&&<button onClick={()=>{continuing.current=false;setMessage('当前批次完成后停止，已经保存的进度会保留。');}}>停止后续批次</button>}</div>
          <small>{current.project.discoveryProvider==='apollo'?`Apollo 已预占 ${current.counts.reservedCredits||0} / ${current.project.maxApolloCredits} 积分 · 已记录请求 ${current.counts.requests} 次`:`已记录请求 ${current.counts.requests} 次 · 预留估算 USD ${current.counts.reservedUsd.toFixed(2)}`} · 实际扣费待供应商核对。CSV 可用 Excel 打开。</small>
        </section>
        {!!current.batches?.length&&<section className="search-panel"><h2>搜索批次与来源</h2><p>{current.project.discoveryProvider==='apollo'?'Apollo 每页最多 100 家企业；原始响应与不适配记录均保留，采购需求待核实。':'每次最多返回 50 个网页，企业身份、所在地和采购需求仍需核实。'}</p><div className="search-batches">{current.batches.map((b:any,i:number)=><article key={i}><strong>{b.query}</strong><p>{b.provider==='bocha'?'博查':b.source} · {b.status} · 返回 {b.count} · 新增 {b.added} · 重复 {b.duplicates} · 排除 {b.excluded}</p>{b.error&&<p>{b.error}</p>}</article>)}</div></section>}
        {!current.companies.length?<section className="search-panel search-empty"><span>01</span><h2>还没有采集到客户</h2><p>任务条件已经保存。接入来源后，从这里继续搜索并查看真实候选。</p></section>:<div className="search-company-list">{current.companies.map(c=><article className="search-panel" key={c.id}><div className="search-heading"><h2>{c.name}</h2><span className="badge">{c.status}</span></div><p>{c.apolloId?`Apollo 总部所在地：${c.country} ${c.city} · 行业：${c.industry||'未提供'} · 员工：${c.employees??'未提供'}`:`目标市场：${c.targetMarket} · 企业所在地：${c.country}`} · 采购意向待核实</p><div className="search-actions">{safeLink(c.website)&&<a href={safeLink(c.website)} target="_blank" rel="noreferrer">查看网站 ↗</a>}{safeLink(c.source)&&<a href={safeLink(c.source)} target="_blank" rel="noreferrer">发现来源 ↗</a>}</div><details className="discovery-evidence"><summary>搜索发现依据（{c.discovery?.length||0} 条）</summary>{c.discovery?.map((e:any,i:number)=><article key={i}><a href={safeLink(e.url)} target="_blank" rel="noreferrer">{e.title||e.url}</a><p>{e.summary||'搜索结果未提供摘要'}</p><small>关键词：{e.query} · {e.provider==='bocha'?'博查':e.provider}</small></article>)}</details>{c.profile&&<details><summary>企业识别线索 · 待核实</summary><p>地区线索：{c.city} · {c.profile.sourceType}</p><p>黄铜业务：{c.profile.productEvidence}</p><p>地区依据：{c.profile.regionEvidence}</p></details>}<div className="platform-grid">{c.platforms.map((p:any)=><details key={p.platform}><summary>{p.status.startsWith('已完成')?'☑':'☐'} {p.platform}<small>{p.status}</small></summary>{safeLink(p.url)&&<a href={safeLink(p.url)} target="_blank" rel="noreferrer">资料来源 ↗</a>}<p>{p.summary||p.error||'尚无可用资料'}</p></details>)}</div><details><summary>联系人与合作切入点</summary>{c.contacts.map((p:any,i:number)=><p key={i}>{p.name} · {p.title}<br/>{p.email||'邮箱待补充'} · {p.emailStatus}<br/>{p.phone||'电话待补充'}{safeLink(p.source)&&<><br/><a href={safeLink(p.source)} target="_blank" rel="noreferrer">联系方式来源 · 归属待核实 ↗</a></>}</p>)}<p>{c.analysis?.fit||c.analysisStatus||'分析待生成'}</p><p>{c.analysis?.pain}</p>{c.qualification&&<><p>当前适配依据：{c.qualification.reasons?.join('；')}</p>{c.score&&<p>评分 {c.score.total} / 100 · {c.score.grade} · 资料覆盖 {c.score.coverage}%</p>}</>}
            {c.qualification&&<details><summary>查看官网核实与适配依据</summary>{c.qualification.evidence?.map((e:any,i:number)=><div key={i}><strong>{['企业身份','目标市场','买方业务','合作关系'][i]||'官网依据'}</strong><p>{e.quote}</p><a href={safeLink(e.url)} target="_blank" rel="noreferrer">核实来源 ↗</a></div>)}<p>关键未知：{c.qualification.criticalUnknowns?.join('；')||'当前判断没有关键缺项；实际采购意愿仍待沟通'}</p></details>}
            {c.outreach?<><h3>邮件组草稿 · 待审核</h3>{c.outreach.subjects.map((s:string,i:number)=><p key={i}>主题 {i+1}：{s}</p>)}<h4>首信</h4><pre>{c.outreach.first}</pre>{c.outreach.followups.map((s:string,i:number)=><div key={i}><h4>跟进草稿 {i+1}</h4><pre>{s}</pre></div>)}<small>尚未发送；需设置真实发信身份并批准具体内容。</small></>:c.analysis?.draft&&<><h3>开发信草稿 · 待审核</h3><pre>{c.analysis.draft}</pre></>}
            {c.outreachStatus&&<p>{c.outreachStatus}{c.outreachError?'：'+c.outreachError:''}</p>}</details></article>)}</div>}
      </>:<section className="search-panel search-empty"><span>开始</span><h2>从企业资料开始寻找适合的客户</h2><p>完成企业分析并保存搜索计划后，名单与进度将出现在这里。</p></section>}
    </section></div>
  </main>;
}
