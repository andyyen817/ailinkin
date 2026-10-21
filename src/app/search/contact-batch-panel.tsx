'use client';
import {useEffect,useRef,useState} from 'react';
import {ContactDepthPanel} from './contact-depth-panel';
export function ContactBatchPanel({tenantId,campaignId,platforms,owner}:{tenantId:string;campaignId:string;platforms:string[];owner:boolean}){
  const [batches,setBatches]=useState<any[]>([]),[selection,setSelection]=useState<any>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [apollo,setApollo]=useState<any>(null);
  const mounted=useRef(true),continueRun=useRef(false),base=`/api/v1/tenants/${tenantId}/contact-batches`,batch=batches.at(-1);
  async function load(){const [a,b]=await Promise.all([fetch(`${base}?campaignId=${campaignId}`),fetch(`/api/v1/tenants/${tenantId}/enterprise-selection?campaignId=${campaignId}`)]);
    if(!a.ok||!b.ok)throw Error('无法读取批次或企业选择');const d=await a.json(),s=await b.json();
    const p=await fetch(`/api/v1/tenants/${tenantId}/contact-apollo?campaignId=${campaignId}`);if(mounted.current){setBatches(d.batches);setSelection(s);if(p.ok)setApollo(await p.json());}return d.batches.at(-1);}
  useEffect(()=>{mounted.current=true;void load().catch(e=>setMessage(e.message));const update=()=>{void load().catch(e=>setMessage(e.message));};window.addEventListener('enterprise-selection-updated',update);
    return()=>{mounted.current=false;continueRun.current=false;window.removeEventListener('enterprise-selection-updated',update);};},[base,campaignId]);
  async function post(action:string){const payload=action==='prepare'?{action,campaignId,selectionId:selection.confirmation.id,platforms}:{action,campaignId,batchId:batch.id};
    const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json();
    if(!r.ok)throw Error(d.error==='CONTACT_BATCH_SCOPE_REQUIRED'?'本批真实搜索、页面与模型额度未启用；没有新增请求。':d.error==='ENTERPRISE_SELECTION_STALE'?'企业名单已变化，请重新确认。':'本步未完成；已保存进度与来源限制，请刷新查看。');return d;}
  async function perform(action:string){setBusy(true);continueRun.current=action==='run';setMessage('正在处理已确认名单');
    try{let current=batch;for(let step=0;step<200&&mounted.current;step++){
      const before=JSON.stringify([current?.units,current?.poolResults,current?.execution?.usage]);await post(action);current=await load();
      const pending=current?.units.some((u:any)=>['pending','needs_search'].includes(u.state))||current?.pendingCompanyAnalysis>0||(current?.poolResults?.length||0)<(current?.companyIds.length||0);
      if(action!=='run'||!continueRun.current||!current?.execution?.enabled||JSON.stringify([current.units,current.poolResults,current.execution.usage])===before||!pending)break;
    }setMessage(action==='prepare'?'批次已保存，只有用户确认的企业进入本批。':action==='reuse'?'已复用可用的保存结果，没有新增外部请求。':'本次处理已结束；请查看每个来源的完成、受限与待补项。');window.dispatchEvent(new Event('contact-batch-updated'));
    }catch(e){setMessage((e as Error).message);await load().catch(()=>{});}finally{continueRun.current=false;if(mounted.current)setBusy(false);}}
  const labels:Record<string,string>={pending:'待读取',needs_search:'待精准账号搜索',needs_identity:'待核实企业身份',cached:'已复用保存结果',cached_fallback:'已复用官网；社媒入口仍受限',query_done:'精准查询片段已保存，关系待核实',not_found:'本次未发现',outside_scope:'本批范围或额度之外，缺项已保留',blocked:'访问受限或待处理',unknown:'结果未知，禁止重发',done:'本页已处理',running:'处理中'};
  async function fallback(){setBusy(true);try{for(let i=apollo?.requests||0;i<3;i++){
    const r=await fetch(`/api/v1/tenants/${tenantId}/contact-apollo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaignId})});if(!r.ok)throw Error('Apollo本步未完成，请查看已保存的权限或请求状态；没有重复未知请求。');await load();
    }setMessage('Apollo候选已保存，域名筛选不证明现任关系；未揭露个人邮箱或电话。');window.dispatchEvent(new Event('contact-batch-updated'));
    }catch(e){setMessage((e as Error).message);await load().catch(()=>{});}finally{setBusy(false);}}
  return <section id="contact-batch" className="search-panel" aria-label="确认名单的联系人研究批次" aria-busy={busy}>
    <h2>第六步：批次研究企业联系人</h2><p>只研究第五步确认的企业。各来源先保存文字和联系链接，同公司资料去重后统一分析人员；旧结果优先复用，普通受限会记录并处理其他获准单元。</p>
    <p role="status">{message}</p><p>当前确认 {selection?.confirmation?.valid?selection.selected.length:0} 家；选择平台 {platforms.length} 个。</p>
    {apollo&&<><p>Apollo人员回退：已记录 {apollo.requests} / 3 次查询，预占 {apollo.reservedCredits} 积分；{apollo.denied?'当前接口权限未通过':apollo.unknown?'请求结果未知，禁止重复':'现任关系仍待核实'}。</p>
      <button disabled={busy||!owner||!apollo.enabled||apollo.unknown||apollo.requests>=3} onClick={()=>void fallback()}>用已批准的Apollo查询人员候选</button></>}
    <button disabled={busy||!owner||!selection?.confirmation?.valid||!platforms.length} onClick={()=>void perform('prepare')}>建立确认名单的研究批次</button>
    {batch&&<><p>批次 {batch.id} · 企业 {batch.companyIds.length} 家 · 账号／平台单元 {batch.units.length} 个。实际人员数量以已保存资料为准。</p>
      <p>本批搜索 {batch.execution?.usage.searchRequests||0} 次 · 页面 {batch.execution?.usage.pageReads||0} 次 · 模型 {batch.execution?.usage.modelRequests||0} 次 · 费用预占 US${(batch.execution?.usage.reservedUsd||0).toFixed(2)}</p>
      <button disabled={busy||!owner} onClick={()=>void perform('reuse')}>复用已保存的批次资料</button>
      <button disabled={busy||!owner||!batch.execution?.enabled} onClick={()=>void perform('run')}>按已确认额度继续批次研究</button>
      <button disabled={busy||!owner} onClick={()=>void perform('recover')}>检查并恢复中断批次</button>
      {busy&&<button onClick={()=>{continueRun.current=false;setMessage('当前单元保存后停止，不启动下一单元。');}}>停止后续单元</button>}
      {!batch.execution?.enabled&&<p>本批真实执行额度未启用或已结束；资料可复用，缺项继续保留。</p>}
      <ContactDepthPanel coverage={batch.execution?.coverage}/>
      <div aria-label="同公司来源汇总"><h3>同公司资料汇总</h3>{(batch.sourcePools||[]).map((p:any)=><p key={p.companyId}>{p.companyName}：已保存 {p.uniqueBlocks} 段独立文字，来自 {p.sourcePlatforms.join('、')||'尚无可读来源'}；本次最多分析 {p.analyzedBlocks} 段，未纳入 {p.omittedBlocks.length} 段仍保留。</p>)}
        {(batch.poolResults||[]).map((p:any,i:number)=><article key={i}><p>{p.companyName}：{p.state==='cached'?'已复用同公司分析':p.state==='done'?'汇总分析已保存':p.state==='no_evidence'?'没有可读证据，未调用模型':p.state==='budget_reached'?'模型额度已到，资料已保留':p.state}；观察到人物提及 {p.people} 条，任职及采购权按联系人表核实。</p>
          {!!p.unknowns?.length&&<details><summary>查看 {p.unknowns.length} 项身份与资料缺项</summary>{p.unknowns.map((v:string,j:number)=><p key={j}>{v}</p>)}</details>}
          {!!p.rejected&&<p>{p.rejected} 条人物输出未通过原文检查，原始响应继续保留。</p>}</article>)}</div>
      <details open><summary>逐企业、逐来源进展与缺项</summary>{batch.units.map((u:any)=><article key={u.id}><strong>{u.companyName} · {u.platform}</strong>
        {u.personName&&<p>核对姓名：{u.personName}；当前任职、日期与采购权仍需证据。</p>}<p>{labels[u.state]||u.state} · {u.reason||'等待本批处理'}</p>{u.url&&<a href={u.url} target="_blank" rel="noreferrer">公开入口</a>}{u.query&&<p>精准查询：{u.query}</p>}
        {!!u.searchEvidenceIds?.length&&<p>保存公开查询片段 {u.searchEvidenceIds.length} 条；不能据此认定采购意愿。</p>}</article>)}</details>
    </>}
    <p>当前为页面启动的有限执行与数据库检查点。页面关闭后，不承诺继续研究；长期后台工作器尚未启用。发送 0 封。</p>
  </section>;
}
