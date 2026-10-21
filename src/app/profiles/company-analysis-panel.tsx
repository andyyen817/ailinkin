'use client';
import {useEffect, useState, type FormEvent} from 'react';
import {companyAnalysisInput, type CompanyAnalysisInput} from '@/domain/company-analysis';
import type {presentAnalysis} from '@/server/company-analysis-service';
import CompanyAnalysisReport from './company-analysis-report';
import {selectSavedAnalysis} from '@/domain/company-analysis-selection';
import './company-analysis.css';
import {MarketResearchPanel} from './market-research-panel';
import {enterpriseMarketReady} from '@/domain/enterprise-market';
import {readCompanyDocument} from './company-document-reader';
type View = ReturnType<typeof presentAnalysis>;
type Props = {tenant: string; owner: boolean; company: Record<string, unknown> | null; products: Array<{data: Record<string, unknown>}>};
const messages: Record<string, string> = {
  INVALID_INPUT: '请检查企业名称、资料内容和输入长度。', OWNER_REQUIRED: '只有企业负责人可以提交分析。',
  ANALYSIS_BUSY_OR_UNRESOLVED: '任务正在处理，或上次请求结果未知；请勿重复启动。',
  ANALYSIS_NOT_FOUND: '分析记录不存在或当前企业无权访问。', ANALYSIS_VERSION_CONFLICT: '记录已更新，请刷新后查看。',
  HISTORY_SCOPE_UNAVAILABLE: '所选历史任务不可用或属于其他市场，请重新预览并选择。',
  ANALYSIS_REVIEW_REQUIRED: '历史报告或资料版本尚未通过当前检查，请更新分析。',
  BUYER_CHECK_REQUIRED: '该客户方向的采购关系或查询尚未通过检查，请查看报告中的原因。',
  TARGET_MARKET_REQUIRED:'请先选择一个目标市场，再预览对应搜索计划。',
  TARGET_MARKET_NOT_AVAILABLE:'所选市场不属于当前企业分析，请重新选择。',
  PROFILE_NEEDS_INFORMATION:'该方向在所选市场尚无通过检查的查询，请补充企业资料或更新分析。',
};
export default function CompanyAnalysisPanel({tenant, owner, company, products}: Props) {
  const [input, setInput] = useState<CompanyAnalysisInput>(() => ({
    companyName: String(company?.name || ''), business: String(company?.business || ''),
    website: String(company?.website || ''), details: products.map(p => JSON.stringify(p.data)).join('\n').slice(0, 12000),
    market: '',marketMode:'operating_presence', intent: '', answers: [], documents: [],
  }));
  const [row, setRow] = useState<View | null>(null), [history, setHistory] = useState<View[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [missing, setMissing] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<any>(null), [provider, setProvider] = useState('web');
  const base = `/api/v1/tenants/${tenant}/company-analysis`;
  useEffect(() => {
    let active = true;
    void fetch(base).then(async r => {if (!r.ok) throw Error('无法读取企业分析记录。'); return r.json();}).then(data => {
      if (!active) return; setHistory(data.analyses); setMissing(data.missing);
      const selected=selectSavedAnalysis<View>(data.analyses,new URLSearchParams(location.search).get('analysisId'));
      if (selected) {setRow(selected); setInput(selected.input);}
    }).catch(e => {if (active) setMessage(e.message);}).finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [base]);
  const field = (name: keyof CompanyAnalysisInput, value: string) => setInput(old => ({...old, [name]: value}));
  async function post(body: unknown) {
    const response = await fetch(base, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await response.json();
    if (!response.ok) throw Error(messages[data.error] || '操作未完成，资料已保留，请检查权限、配置或刷新记录。');
    return data;
  }
  function remember(value: View) {setRow(value); setHistory(old => [value, ...old.filter(r => r.id !== value.id)]);const url=new URL(location.href);url.searchParams.set('analysisId',value.id);historyForURL(url);}
  function historyForURL(url:URL){window.history.replaceState(null,'',url);}
  async function save(run: boolean, value = input) {
    if (loading || busy || !owner) return; setBusy(true); setMessage(''); setPlan(null);
    try {
      const valid = companyAnalysisInput.safeParse(value);
      if (!valid.success) throw Error('请填写企业名称，并提供业务介绍、官网或资料内容。');
      if(run&&!enterpriseMarketReady(valid.data))throw Error('请先选择目标国家或地区，再让 AI 分析目标市场。资料仍可先保存。');
      setInput(valid.data);
      const saved = (await post({action: 'create', input: valid.data,previousId:row?.id})).analysis;
      remember(saved);setInput(saved.input);
      if (run) {const result = await post({action: 'run', id: saved.id}); remember(result.analysis); setMessage(result.analysis.message);}
      else setMessage('企业资料已保存，可以稍后继续分析。');
    } catch (e) {setMessage((e as Error).message);} finally {setBusy(false);}
  }
  async function readFiles(files: FileList | null) {
    try {
      if (!files) return; if (files.length > 4) throw Error('一次最多提供 4 份资料。');
      setBusy(true);setMessage('正在本地读取资料文字；文件原件不会外发。');
      const documents: CompanyAnalysisInput['documents'] = [];
      for (const file of Array.from(files)) {
        documents.push(await readCompanyDocument(file));
      }
      setInput(old => ({...old, documents})); setMessage('资料文字已读取，保存后会与本次分析一起保留。');
    } catch (e) {setMessage((e as Error).message);} finally {setBusy(false);}
  }
  async function preview(profileId: string, relatedCampaignIds: string[] = [],market?:string) {
    if (!row || busy) return; setBusy(true); setMessage('');
    try {setPlan((await post({action: 'plan', id: row.id, profileId, relatedCampaignIds,market})).plan);}
    catch (e) {setMessage((e as Error).message);} finally {setBusy(false);}
  }
  async function createSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!row || !plan || busy) return; setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await post({action: 'search', id: row.id, profileId: plan.profileId,market:plan.market, expectedVersion: row.version, relatedCampaignIds: plan.relatedCampaignIds,
        discoveryMode:'coverage',expectedTarget:form.get('expectedTarget')?Number(form.get('expectedTarget')):undefined, discoveryProvider: provider, maxRequests: Number(form.get('requests')),
        maxSpendUsd: Number(form.get('budget')), maxApolloCredits: Number(form.get('credits') || 1)});
      location.assign(`/search?tenantId=${encodeURIComponent(tenant)}`);
    } catch (e) {setMessage((e as Error).message); setBusy(false);}
  }
  const checkedInput = companyAnalysisInput.safeParse(input);
  const dirty = row && (!checkedInput.success || JSON.stringify(companyAnalysisInput.parse(row.input)) !== JSON.stringify(checkedInput.data));
  return <section className="company-analysis" aria-label="企业 AI 分析" aria-busy={loading || busy}>
    <h2>第一步：企业资料与目标市场</h2><p>介绍产品、能力和限制，再明确本次拓展市场。AI 分析客户、渠道及市场条件。</p>
    <button type="button" disabled={loading||busy||!owner} onClick={()=>{setRow(null);setPlan(null);setInput({companyName:'',business:'',website:'',details:'',intent:'',market:'',marketMode:'operating_presence',answers:[],documents:[]});setMessage('已开始新资料，保存后建立独立记录；已有分析仍保留。');}}>开始新的分析资料</button>
    {missing.length > 0 && <p className="analysis-notice">资料可以先保存。真实 AI 分析待配置：{missing.join('、')}。</p>}
    {message && <p className="form-message" role="status">{message}</p>}
    {row&&<p className="analysis-notice">当前记录：{row.input.companyName} · {row.id} · {row.usage.requests>0?'含模型请求记录':row.previousId?'继承已保存分析':'保存记录，模型来源待核实'}。{row.review.reason}</p>}
    <form className="profile-panel" onSubmit={e => {e.preventDefault(); void save(true);}}>
      <fieldset disabled={loading || !owner || busy}><legend>企业基本资料{loading ? '（正在读取…）' : ''}</legend>
        <label>企业名称<input aria-label="分析企业名称" required maxLength={200} value={input.companyName} onChange={e => field('companyName', e.target.value)} /></label>
        <label>主营产品、服务或业务介绍<textarea aria-label="业务介绍" rows={4} maxLength={12000} value={input.business} onChange={e => field('business', e.target.value)} placeholder="用自己的话介绍企业，不需要填写客户类型" /></label>
        <label>公司官网（选填）<input aria-label="分析公司官网" type="url" value={input.website} onChange={e => field('website', e.target.value)} /></label>
        <label>优势、供货能力、服务范围或限制<textarea aria-label="能力与限制" rows={3} maxLength={12000} value={input.details} onChange={e => field('details', e.target.value)} /></label>
        <details><summary>分别补充多个产品／服务（选填）</summary>
          {(input.offerings||[]).map((p,i)=><fieldset key={i}><legend>产品／服务 {i+1}</legend>{(['name','description','capabilities','limitations'] as const).map((key,j)=><label key={key}>{['名称','产品、用途或服务介绍','已知能力','限制'][j]}<textarea aria-label={`产品${i+1}${key}`} maxLength={key==='name'?800:3000} value={p[key]} onChange={e=>setInput(old=>({...old,offerings:(old.offerings||[]).map((o,n)=>n===i?{...o,[key]:e.target.value}:o)}))}/></label>)}
            <button type="button" onClick={()=>setInput(old=>({...old,offerings:old.offerings?.filter((_,n)=>n!==i)}))}>移除此产品</button></fieldset>)}
          <button type="button" disabled={(input.offerings?.length||0)>=12} onClick={()=>setInput(old=>({...old,offerings:[...old.offerings||[],{name:'',description:'',capabilities:'',limitations:''}]}))}>添加产品／服务</button>
        </details>
        <label>已有的拓展想法（选填）<input maxLength={2000} value={input.intent} onChange={e => field('intent', e.target.value)} /></label>
        <label>目标国家或地区（分析前必填）<input aria-label="分析目标市场" maxLength={200} value={input.market} onChange={e => field('market', e.target.value)} placeholder="例如：印尼、菲律宾" /></label>
        <label>地区筛选含义<select aria-label="地区筛选含义" value={input.marketMode||'headquarters'} onChange={e=>setInput(old=>({...old,marketMode:e.target.value as CompanyAnalysisInput['marketMode']}))}><option value="headquarters">总部所在地</option><option value="operating_presence">在当地经营</option><option value="service_coverage">服务覆盖当地</option></select></label>
        <small>多个国家用顿号或逗号分隔；保存计划时每次选择一个市场。地区目标不代表企业已经具备当地服务能力。</small>
        <label>企业介绍或产品目录<input aria-label="企业资料文件" type="file" accept=".txt,.md,.pdf,.docx" multiple onChange={e => void readFiles(e.target.files)} /></label>
        <small>最多4份、每份8MB／20000字，PDF最多50页。只提取文字；扫描版需先转文字，未取得内容会提示。</small>
        {input.documents.map((d, i) => <p key={i}>{d.name} · {d.text.length} 字 <button type="button" onClick={() => setInput(old => ({...old, documents: old.documents.filter((_, n) => n !== i)}))}>移除</button></p>)}
        <div className="analysis-actions"><button type="button" onClick={() => void save(false)}>保存资料</button><button type="submit">{busy ? '正在处理…' : '让 AI 分析适合的客户'}</button></div>
      </fieldset>
    </form>
    {row && <p>当前记录：{({draft: '资料已保存', running: '分析中', blocked: '等待处理', unknown: '请求待核对', complete: '已生成建议'} as Record<string, string>)[row.state]} · 模型：{row.model === 'unconfigured' ? '尚未设置' : row.model} · 接口请求 {row.usage.requests} 次 · 费用预占 ${row.usage.reservedUsd}，实际费用尚待核实</p>}
    {dirty && <p className="analysis-notice">你已修改资料。下方是上一版分析，请更新分析后生成新的搜索计划。</p>}
    {row?.report && <CompanyAnalysisReport report={row.report} sources={row.sources} busy={busy || !owner || Boolean(dirty)} market={row.input.market}
      onPlan={(id,market) => void preview(id,[],market)} onAnswers={async answers => {
        if (!answers.length) {setMessage('请至少补充一个回答，也可以填写“不确定”。'); return;}
        await save(true, {...input, answers: [...input.answers.filter(a => !answers.some(n => n.questionId === a.questionId)), ...answers]});
      }} />}
    {row?.report&&!dirty&&<MarketResearchPanel key={row.id} tenantId={tenant} analysisId={row.id} version={row.version} market={row.input.market} owner={owner} onPlan={(id,market)=>void preview(id,[],market)}/>}
    {plan && <form className="profile-panel" onSubmit={createSearch}><h2>搜索计划：{plan.label}</h2><p>{plan.role} · {plan.application} · {plan.market}</p>
      <p>建议搜索词：{plan.keywords.join(' / ')}</p><p>已关联历史官网 {plan.excludedDomains.length} 个；提交前会再次核对排除名单。</p>
      {plan.historyChoices.length > 0 && <details className="history-links"><summary>关联已有搜索名单</summary>
        <p>同组和已确认的关联会自动继承。其他名单只有买家用途相关时才勾选；暂不适合的旧客户也会加入排除。</p>
        <div className="history-options">{plan.historyChoices.map((h: any) => <label key={h.id}>
          <input type="checkbox" aria-label={`关联 ${h.label}`} checked={h.related}
            disabled={busy || Boolean(dirty) || (h.related && !plan.relatedCampaignIds.includes(h.id))}
            onChange={e => void preview(plan.profileId, e.target.checked ? [...plan.relatedCampaignIds, h.id] : plan.relatedCampaignIds.filter((id: string) => id !== h.id),plan.market)} />
          <span>{h.label}<small>{h.country} · {h.provider} · {h.companyCount} 家已保存{h.related ? ' · 已关联' : ''}</small></span>
        </label>)}</div>
      </details>}
      {provider === 'web' && <p>网页来源：{plan.webSource?.provider||'待配置'} · {plan.webSource?.excludeLimit==null?'排除容量以供应商实际限制为准':`每请求最多排除 ${plan.webSource.excludeLimit} 个官网`}</p>}
      {provider === 'web' && plan.webSource?.excludeLimit!=null && plan.excludedDomains.length>plan.webSource.excludeLimit && <p role="status">相关官网超过当前来源排除容量，请细化买家范围后再搜索。</p>}
      <label>期望客户数量（选填）<input name="expectedTarget" type="number" min={1} max={10000} placeholder="按市场覆盖与预算持续发现" /></label>
      <p>期望数量不会提前结束搜索或保证凑满。系统先覆盖主要买家群体，按新增客户、来源质量和预算继续。</p>
      <label>搜索来源<select value={provider} onChange={e => setProvider(e.target.value)}><option value="web">网页搜索</option><option value="apollo">Apollo 企业搜索</option></select></label>
      <label>请求上限<input name="requests" type="number" min={0} max={10000} defaultValue={0} required /></label>
      <label>费用上限（USD）<input name="budget" type="number" min={0} step="0.01" defaultValue={0} required /></label>
      {provider === 'apollo' && <label>Apollo 积分上限<input name="credits" type="number" min={1} max={5} defaultValue={1} /></label>}
      <button disabled={busy || Boolean(dirty)}>保存计划并前往搜索</button><p className="muted">此步骤保存搜索任务，进入搜索页后按当前接口权限与额度执行。</p>
    </form>}
    {history.length > 0 && <details><summary>已保存的分析记录（{history.length}）</summary>{history.map(item => <button type="button" key={item.id} disabled={busy} onClick={() => {remember(item); setInput(item.input); setPlan(null);}}>{item.input.companyName} · {new Date(item.createdAt).toLocaleString('zh-CN')}</button>)}</details>}
  </section>;
}
