'use client';
import {useState,type FormEvent} from 'react';
import {targetMarkets,marketKey} from '@/domain/target-markets';
import type {AnalysisReport, AnalysisSource, CompanyAnalysisInput} from '@/domain/company-analysis';
import CompanyQualityPanel,{type QualityView} from './company-quality-panel';

type Props = {report: AnalysisReport; sources: AnalysisSource[]; busy: boolean;
  onAnswers: (answers: CompanyAnalysisInput['answers']) => Promise<void>;
  onPlan: (profileId: string,market?:string) => void; market: string};
export default function CompanyAnalysisReport({report, sources, busy, onAnswers, onPlan, market}: Props) {
  const quality=(report.quality as QualityView | undefined) || null;
  const markets=targetMarkets(market),[chosen,setChosen]=useState('');
  const selected=markets.includes(chosen)?chosen:markets[0]||'';
  async function answer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onAnswers(report.questions.map(q => ({questionId: q.id, question: q.text, answer: String(data.get(q.id) || '').trim()})).filter(a => a.answer));
  }
  return <section className="company-analysis-report" aria-label="AI 企业分析报告">
    <h2>AI 对企业的理解</h2>
    <CompanyQualityPanel quality={quality} />
    <p>{report.summary}</p><p><strong>业务与合作方式：</strong>{report.businessModel}</p>
    <div className="analysis-columns">
      <section><h3>资料提及的能力</h3><ul>{report.capabilities.map((v, i) => <li key={i}>{v}</li>)}</ul></section>
      <section><h3>限制与未知</h3><ul>{report.limitations.map((v, i) => <li key={i}>{v}</li>)}</ul></section>
    </div>
    {report.conflicts.length > 0 && <section role="status"><h3>需要核对的矛盾</h3><ul>{report.conflicts.map((v, i) => <li key={i}>{v}</li>)}</ul></section>}
    <h2>建议开发的客户方向</h2>
    {markets.length>1&&<label>本次搜索市场<select aria-label="本次搜索市场" value={selected} disabled={busy} onChange={e=>setChosen(e.target.value)}>{markets.map(m=><option key={m} value={m}>{m}</option>)}</select></label>}
    <p className="muted">以下是根据企业资料推导的合作方向，实际公司的需求还需要搜索与核实。</p>
    {!report.profiles.length && <p>目前资料不足，请先回答下方关键问题。</p>}
    {report.profiles.map(profile => {
      const buyer=quality?.buyers.find(b=>b.id===profile.id);
      const matchesMarket=buyer?.queries.some(q=>marketKey(q.market)===marketKey(selected));
      return <article className="profile-card" key={profile.id}>
      <h3>{profile.label} <small>{profile.priority}</small></h3>
      <dl>
        <dt>合作角色与用途</dt><dd>{profile.role} · {profile.application}</dd>
        <dt>为什么推荐</dt><dd>{profile.why}</dd>
        <dt>建议联系谁</dt><dd>{profile.decisionRoles.join('、') || '待核实决策角色'}</dd>
        <dt>待核实条件</dt><dd>{profile.unknowns.join('；') || '仍需核实具体企业的合作需求'}</dd>
      </dl>
      <details><summary>查看推导依据与建议搜索词</summary>
        <ul>{profile.factIds.map(id => {
          const fact = report.facts.find(f => f.id === id);
          return <li key={id}>{fact?.claim}：{fact?.quote}</li>;
        })}</ul><p>{profile.queryTerms.join(' / ')}</p>
      </details>
      {quality?.buyers.find(b=>b.id===profile.id)?.queries.map((q,i)=><details key={i}><summary>查询要找什么组织：{q.business} · {q.roleTerm}</summary>
        <p>搜索词：{q.text}</p><p>找到后核实：{q.verify.join('；')}</p><p>注意误搜：{q.avoidRoles.join('；') || '仍需核对实际买方角色'}</p></details>)}
      {quality?.buyers.find(b=>b.id===profile.id)?.reasons.map((reason,i)=><p className="muted" key={i}>{reason}</p>)}
      <button type="button" disabled={busy || !market || !buyer?.ready || !matchesMarket} onClick={() => onPlan(profile.id,selected)}>生成此方向的搜索计划</button>
      {!market && <p className="muted">填写目标市场并更新分析后，即可生成计划。</p>}
    </article>;})}
    {report.questions.length > 0 && <form className="profile-panel" onSubmit={answer}>
      <h2>补充这些信息，可以改善判断</h2>
      {report.questions.map(q => <label key={q.id}>{q.text}<small>{q.reason}</small>
        <textarea name={q.id} aria-label={q.text} maxLength={800} disabled={busy} placeholder="可以填写“不确定”" />
      </label>)}
      <button disabled={busy} type="submit">补充回答并更新分析</button>
    </form>}
    <details><summary>企业事实与原始来源</summary>
      {report.facts.map(fact => {
        const source = sources.find(s => s.id === fact.sourceId);
        return <article key={fact.id}><strong>{fact.claim}</strong><blockquote>{fact.quote}</blockquote>
          <p>{source?.kind === 'website' ? '网页内容，尚需核实' : '企业提供的资料'} · {source?.label}</p></article>;
      })}
    </details>
  </section>;
}
