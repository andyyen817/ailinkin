'use client';
import {useEffect,useState} from 'react';
const notices:Record<string,string>={CONTACT_SCOPE_REQUIRED:'尚未确认本轮真实读取与模型额度。',CONTACT_SCOPE_EXPIRED_OR_MISMATCH:'本次范围已到期或与所选企业、账号不符。',CONTACT_MODEL_KEY_MISSING:'服务端模型设置缺失，尚未发出请求。',CONTACT_RESEARCH_BUSY_OR_RECOVERY_REQUIRED:'研究正在处理或需核对上次结果，请先刷新。',CONTACT_REQUEST_UNKNOWN:'上次结果未知，系统没有重新请求。',OWNER_REQUIRED:'只有企业负责人可以开始研究。'};
export function ContactExecutionResults({runs,tenantId,campaignId,onSave,busy=false}:{runs:any[];tenantId:string;campaignId:string;onSave?:(id:string)=>void;busy?:boolean}){
  return <div aria-label="社媒实际读取结果">{runs.map(run=><article className="discovery-evidence" key={run.id}>
    <h3>{run.companyName} · {run.outcome?.label||(run.state==='done'?'资料已保存':run.state==='unknown'?'结果待核对':'研究处理中')}</h3>
    {run.fallbackUsed&&<p className="search-message">社媒来源未取得正文，系统已自动转用同企业保存的官网证据；没有重新抓取网站。</p>}
    {run.events?.map((e:any,i:number)=><p key={i}>自动处理：{e.action==='source_failed'?'保存来源受限原因':e.action==='reuse_saved_official'?'复用已存官网资料':e.action} {e.source||e.sources?.join('、')||''}</p>)}
    <p>本次记录 {run.requests.length} 个读取／模型请求 · 人员候选 {run.people.length} 人 · 公开联系链接 {run.channels.length} 条 · 发送 {run.sent} 封</p>
    <p>费用预留 US${run.requests.reduce((n:number,q:any)=>n+(q.reservedCost||0),0).toFixed(2)}；实际扣费以供应商账单为准。</p>
    {run.reason&&<p role="alert">{run.reason}</p>}
    {run.coverage&&<p>已读文字 {run.coverage.charactersRead||0} 字符；{run.coverage.complete?'本次取得的文字范围完整':'覆盖有限，未声称读完账号全部资料'}。</p>}
    <p>{run.identity?.notice}</p>
    {run.people.map((p:any)=><div key={p.sourcePersonId}><strong>{p.name}</strong> · {p.title||'职位待核实'}<p>{p.relationship==='mentioned'?'文章提及人员，不能认定是目标企业员工。':'现任关系、采购权限及采购意愿待核实。'}{p.state==='image_fields_need_review'?'图片字段需回看。':''}{p.crmContactId?'已保存为 CRM 候选。':''}</p>
      {p.evidence.map((e:any,i:number)=><p key={e.id+':'+i}><a href={e.sourceUrl} target="_blank" rel="noreferrer">出处</a>：{e.quote}</p>)}</div>)}
    {!run.people.length&&<p>没有取得有依据的具名人员，继续保留企业联系渠道。</p>}
    {run.channels.map((c:any)=><p key={c.kind+':'+c.value}>{c.kind}：{c.value} · 未验证可联系性 · <a href={c.evidence[0].sourceUrl} target="_blank" rel="noreferrer">出处</a></p>)}
    {run.images.map((i:any)=><p key={i.imageId}><a href={`/api/v1/tenants/${tenantId}/contact-evidence?campaignId=${campaignId}&imageId=${i.imageId}`} target="_blank" rel="noreferrer">查看私有截图区块</a> · {i.region.width}×{i.region.height} · 需回看文字</p>)}
    {run.unknowns.map((s:string,i:number)=><p key={i}>{s}</p>)}
    {run.recoveryPlan?.map((a:any,i:number)=><p key={'a'+i}>{a.reason} {a.state==='requires_scope'?'需要可用来源及剩余额度。':''}</p>)}
    {onSave&&run.people.some((p:any)=>!['mentioned','former_employee'].includes(p.relationship))&&<button disabled={busy} onClick={()=>onSave(run.id)}>保存人员候选到客户库</button>}
    <details><summary>保存的文字与覆盖证据</summary>{run.page?.blocks.map((b:any)=><div key={b.id}><a href={b.sourceUrl} target="_blank" rel="noreferrer">{b.sourceUrl}</a><p>{b.text}</p></div>)}</details>
  </article>)}</div>;
}
export function ContactExecutionPanel({tenantId,campaignId,plan,owner}:{tenantId:string;campaignId:string;plan:any;owner:boolean}){
  const [status,setStatus]=useState<any>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const base=`/api/v1/tenants/${tenantId}/contact-execute`;
  async function load(){const r=await fetch(`${base}?campaignId=${campaignId}`),d=await r.json();if(!r.ok)throw Error('无法读取当前研究范围或结果。');setStatus(d);}
  useEffect(()=>{let active=true;void fetch(`${base}?campaignId=${campaignId}`).then(async r=>{const d=await r.json();if(!r.ok)throw Error('无法读取研究状态。');if(active)setStatus(d);}).catch(e=>{if(active)setMessage(e.message);});return()=>{active=false;};},[base,campaignId]);
  async function run(companyId:string,platform:string,url:string){
    setBusy(true);setMessage('正在读取公开资料并保存证据，请稍候。');
    try{const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'run',campaignId,planId:plan.id,companyId,platform,url})}),d=await r.json();
      if(!r.ok)throw Error(notices[d.error]||'本次未完成，请刷新查看保存的请求及原因。');await load();setMessage(d.reused?'复用已有研究结果，没有重复读取或模型调用。':'实际读取结果及证据已保存；人员身份仍需核实。');
    }catch(e){setMessage(e instanceof Error?e.message:'研究未完成');await load().catch(()=>{});}finally{setBusy(false);}
  }
  async function saveCandidates(runId:string){
    setBusy(true);try{const r=await fetch(`/api/v1/tenants/${tenantId}/contact-assets`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save_candidates',campaignId,runId})}),d=await r.json();
      if(!r.ok)throw Error('候选保存未完成，请刷新查看权限和资料。');await load();setMessage(`新保存 ${d.saved} 人；现任关系、采购权及邮箱仍待核实。`);
    }catch(e){setMessage(e instanceof Error?e.message:'保存未完成');}finally{setBusy(false);}
  }
  return <section aria-label="读取社媒文字与关键人" aria-busy={busy}><h3>读取社媒文字与关键人</h3>
    <p>先读取公开文字和明确联系链接；必要截图由 DeepSeek Flash 整理。每次只执行已确认的企业与账号范围。</p>
    {status?.enabled?<p>已确认：{status.scope.platform} · 公开账号 1 页 · Flash 最多 {status.scope.modelRequests} 次 · 截图最多 {status.scope.screenshots} 张 · US${status.scope.maxSpendUsd.toFixed(2)} · 截止 {new Date(status.scope.expiresAt).toLocaleString()}。</p>:<p className="search-message">尚未确认真实读取范围；整理计划可以继续复用，本步骤不会访问社媒或模型。</p>}
    {plan.companies.map((c:any)=><div key={c.companyId}><h4>{c.name}</h4>{c.accounts.map((a:any)=>{
      const allowed=status?.enabled&&status.scope.companyId===c.companyId&&status.scope.platform===a.platform&&status.scope.url===a.url;
      return <p key={a.url}><a href={a.url} target="_blank" rel="noreferrer">{a.platform} · {a.url}</a> <button disabled={!owner||busy||!allowed} onClick={()=>void run(c.companyId,a.platform,a.url)}>读取并提取联系人</button></p>;
    })}{!c.accounts.length&&<p>需要先定位有依据的官方账号。</p>}</div>)}
    <p role="status">{message}</p>{status&&<><ContactExecutionResults runs={status.runs} tenantId={tenantId} campaignId={campaignId} onSave={owner?id=>void saveCandidates(id):undefined} busy={busy}/>
      {status.runs.length>0&&<a href={`/api/v1/tenants/${tenantId}/contact-assets?campaignId=${campaignId}`} download>导出联系人与渠道证据 CSV</a>}</>}
  </section>;
}
