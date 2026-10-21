'use client';
import {useEffect,useRef,useState} from 'react';
export function MarketingMailPanel({tenantId,campaignId,handoff,owner}:{tenantId:string;campaignId:string;handoff:any;owner:boolean}){
  const [data,setData]=useState<any>(null),[sender,setSender]=useState({email:'',name:'',company:''}),[copies,setCopies]=useState<Record<string,{subject:string;body:string}>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const base=`/api/v1/tenants/${tenantId}/marketing-mail`,plan=data?.plans.at(-1);
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function load(restore=false){const r=await fetch(`${base}?campaignId=${campaignId}`);if(!r.ok)throw Error('无法读取邮件计划');const d=await r.json();setData(d);
    if(restore){const saved=d.plans.findLast((p:any)=>p.handoffId===handoff.id&&p.valid);if(saved)setSender(saved.sender);
      setCopies(Object.fromEntries((saved?.messages||handoff.recipients).map((r:any)=>[r.rowId,{subject:r.subject,body:r.body}])));}return d;}
  useEffect(()=>{void load(true).catch(e=>setMessage(e.message));},[base,campaignId,handoff.id]);
  async function perform(action:string){setBusy(true);try{
    const payload=action==='prepare'?{action,campaignId,handoffId:handoff.id,sender,maxFollowups:0,messages:handoff.recipients.map((r:any)=>({...copies[r.rowId],rowId:r.rowId,
      body:copies[r.rowId].body.replaceAll('[Your name]',()=>sender.name).replaceAll('[Company name]',()=>sender.company)}))}:{action,campaignId,planId:plan.id,expectedBasis:plan.basis};
    const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json();
    if(!r.ok)throw Error(d.error==='MARKETING_SCOPE_REQUIRED'?'本批收件人、内容与发送范围尚未启用；没有发信。':d.error==='SENDER_PLACEHOLDER_REQUIRES_REVIEW'?'请补齐署名并审核正文。':'本步未完成，原内容与结果保留，请检查连接和实际范围。');
    await load();setMessage(action==='prepare'?'邮件内容与发件身份已保存，请回看后确认。':action==='confirm'?'邮件内容已确认；真实发送仍按连接、验证和本批范围检查。':'操作结果已保存，请查看实际状态。');
    if(action==='send')for(let i=1;i<50&&mounted.current;i++){
      const latest=await load(),next=latest.plans.find((p:any)=>p.id===plan.id);if(!next?.scopeEnabled||!next.valid||next.messages.some((m:any)=>m.deliveries.some((d:any)=>['unknown','pending'].includes(d.state))))break;
      if(!next.messages.some((m:any)=>!m.deliveries.length&&!m.replies.length&&!m.optOut))break;
      const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,campaignId,planId:next.id,expectedBasis:next.basis})});if(!response.ok)throw Error('后续发送已停止，请查看保存结果；未知请求不重复。');
    }
  }catch(e){setMessage((e as Error).message);await load().catch(()=>{});}finally{setBusy(false);}}
  return <section aria-label="第七步邮件审核与接触" aria-busy={busy}><h2>第七步：选择后审核接触邮件</h2><p>先审核实际收件渠道、发件身份和正文，再确认发送范围。本轮默认不追加自动跟进。</p><p role="status">{message}</p>
    <p>企业发件邮箱：{data?.connection.configured?data.connection.email:'尚未连接'}；邮箱验证：{data?.connection.verifyEnabled?'已配置':'尚未连接'}；回信读取：{data?.connection.replyEnabled?'已配置':'尚未连接'}。</p>
    <fieldset disabled={busy||!owner||handoff.superseded}><legend>实际发件身份与邮件</legend>
      <label>企业发件邮箱<input aria-label="营销发件邮箱" type="email" value={sender.email} onChange={e=>setSender({...sender,email:e.target.value})}/></label>
      <label>发件人姓名<input aria-label="营销署名" value={sender.name} onChange={e=>setSender({...sender,name:e.target.value})}/></label>
      <label>发件企业<input aria-label="营销企业" value={sender.company} onChange={e=>setSender({...sender,company:e.target.value})}/></label>
      {handoff.recipients.map((r:any)=><article key={r.rowId}><h3>{r.companyName} → {r.email}</h3><p>{r.scope==='company'?'公司公共邮箱':'有出处的人员渠道'}；归属与可用性分别检查。</p>
        <label>邮件主题<input aria-label={`邮件主题 ${r.email}`} maxLength={120} value={copies[r.rowId]?.subject||''} onChange={e=>setCopies({...copies,[r.rowId]:{...copies[r.rowId],subject:e.target.value}})}/></label>
        <label>邮件正文<textarea aria-label={`邮件正文 ${r.email}`} rows={10} value={copies[r.rowId]?.body||''} onChange={e=>setCopies({...copies,[r.rowId]:{...copies[r.rowId],body:e.target.value}})}/></label></article>)}
      <button disabled={!handoff.recipients.length||!sender.email||!sender.name||!sender.company} onClick={()=>void perform('prepare')}>保存邮件内容与发件身份</button>
    </fieldset>
    {plan&&<article><h3>已保存的实际邮件计划</h3><p>发件人：{plan.sender.name} · {plan.sender.company} · {plan.sender.email}</p>
      {plan.messages.map((m:any)=><details key={m.rowId} open><summary>{m.email} · {m.state}</summary><p>{m.subject}</p><pre>{m.body}</pre><p>邮箱验证：{m.verification?.status||'未验证'}；已记录发送尝试 {m.deliveries.length} 次；回信 {m.replies.length} 条。</p>{m.replies.length>0&&<p>已收到回信，后续跟进停止。</p>}</details>)}
      <button disabled={busy||!owner||!plan.valid} onClick={()=>void perform('confirm')}>确认收件人与邮件内容</button>
      <button disabled={busy||!owner||!plan.scopeEnabled||!data.connection.verifyEnabled} onClick={()=>void perform('verify')}>验证已选邮箱</button>
      <button disabled={busy||!owner||!plan.scopeEnabled||!data.connection.sendEnabled||!plan.messages.every((m:any)=>m.verification?.status==='valid')} onClick={()=>void perform('send')}>发送已确认的首封邮件</button>
      <button disabled={busy||!owner||!plan.scopeEnabled||!data.connection.replyEnabled} onClick={()=>void perform('check_replies')}>检查已发邮件的回信</button>
      <p>真实发送需连接匹配的企业邮箱、有效验证及具体发送范围。未知发送结果不会自动重发。</p>
    </article>}
    <p>已记录 SMTP 接受 {data?.sent||0} 封；不代表客户阅读。当前尚未启用长期自动跟进工作器。</p>
  </section>;
}
