'use client';
import React,{useState,type FormEvent} from 'react';

export function OperatorCrmPanel({tenantId,campaignId,batchId,owner}:{
  tenantId:string;campaignId:string;batchId:string;owner:boolean;
}){
  const [view,setView]=useState<any>(null),[selected,setSelected]=useState<string[]>([]);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirmed,setConfirmed]=useState(false);
  const base=`/api/v1/tenants/${tenantId}/operator-batches/crm`;
  async function load(){
    const response=await fetch(base+'?'+new URLSearchParams({campaignId,batchId}),{cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Error('暂时无法读取审核资料，请确认本批已完成且你有企业权限。');
    setView(data);setSelected(old=>old.filter(key=>data.people.some((p:any)=>p.personKey===key&&p.canSave)));
    return data;
  }
  async function open(){
    setBusy(true);setMessage('');
    try{await load();}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
  }
  async function save(event:FormEvent){
    event.preventDefault();if(busy||!confirmed||!selected.length)return;
    setBusy(true);setMessage('正在保存审核结果和客户资料…');
    try{
      const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({campaignId,batchId,basisHash:view.basisHash,personKeys:selected,confirm:true})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error==='CRM_REVIEW_STALE'
        ?'资料已更新，请刷新审核资料后重新确认。':'保存未完成，请刷新审核资料查看已有记录，再决定是否重试。');
      const results=data.receipt.results;
      setMessage(data.reused?'已复用上次入库记录，没有新增或重复修改客户。':
        `已保存：新增 ${results.filter((r:any)=>r.outcome==='created').length} 位，补充 ${results.filter((r:any)=>r.outcome==='updated').length} 位，复用 ${results.filter((r:any)=>r.outcome==='skipped').length} 位，身份冲突 ${results.filter((r:any)=>r.outcome==='conflict').length} 位。`);
      setConfirmed(false);await load();
    }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
  }
  const eligible=view?.people.filter((p:any)=>p.canSave)||[];
  return <section className="operator-crm" aria-label="审核联系人并入库">
    <h3>审核联系人，保存到客户库</h3>
    <p>选择要继续跟进的人物。归属和有效期均已核实的邮箱才填入客户邮箱栏；其他候选、社交账号和证据保留在备注。新客户先进入“待筛选”，已有跟进状态及禁止联系标记会保留。</p>
    <button type="button" disabled={busy} onClick={()=>void open()}>
      {view?'刷新审核资料':'审核这批联系人并入库'}
    </button>
    {message&&<p role="status">{message}</p>}
    {view&&<form onSubmit={save}>
      <fieldset disabled={busy||!owner}>
        <legend>选择联系人（本批 {view.people.length} 位）</legend>
        <label className="crm-check"><input type="checkbox" aria-label="选择全部可入库联系人"
          checked={eligible.length>0&&eligible.every((p:any)=>selected.includes(p.personKey))}
          onChange={e=>setSelected(e.target.checked?eligible.map((p:any)=>p.personKey):[])}/>选择全部可入库联系人</label>
        <div className="crm-list"><table><thead><tr>
          <th>选择</th><th>姓名／企业</th><th>入库邮箱</th><th>重复与处理结果</th>
        </tr></thead><tbody>{view.people.map((person:any)=><tr key={person.personKey}>
          <td><input type="checkbox" aria-label={`入库 ${person.name}`} disabled={!person.canSave}
            checked={selected.includes(person.personKey)}
            onChange={e=>setSelected(old=>e.target.checked?[...old,person.personKey]:old.filter(k=>k!==person.personKey))}/></td>
          <td><strong>{person.name}</strong><br/>{person.companyName}<br/>
            {person.profileUrl&&<a href={person.profileUrl} target="_blank" rel="noreferrer">查看个人主页</a>}</td>
          <td>{person.usableEmail||'暂不填入邮箱'}<br/>
            {person.candidateEmail&&<small>候选保留在备注：{person.candidateEmail}<br/>{person.emailState}</small>}</td>
          <td>{person.reason|| (person.contactId?'已在客户库，自动复用':'将新增为待筛选潜客')}
            {person.doNotContact&&<p>已禁止联系，保持原限制</p>}
            {person.contactId&&<p><a href={`/contacts?${new URLSearchParams({
              tenantId,contactId:person.contactId,q:person.name})}`}>查看客户并记录跟进</a></p>}</td>
        </tr>)}</tbody></table></div>
        <label className="crm-check"><input type="checkbox" checked={confirmed} required
          onChange={e=>setConfirmed(e.target.checked)}/>我已查看所选人物，确认保存为待筛选潜客；本次不发送消息</label>
        <button type="submit" disabled={!selected.length||!confirmed||busy||!owner}>
          保存审核结果并入库（{selected.length}人）
        </button>
      </fieldset>
      {!owner&&<p>请由企业负责人审核并保存。</p>}
      {!!view.history.length&&<details><summary>已保存的审核记录（{view.history.length}次）</summary>
        {view.history.map((receipt:any)=><p key={receipt.id}>
          {new Date(receipt.at).toLocaleString('zh-CN')} · 审核 {receipt.results.length} 人
          {receipt.results.filter((r:any)=>r.outcome==='conflict').map((r:any)=><span key={r.personKey}> · {r.name}：{r.reason}</span>)}
        </p>)}</details>}
    </form>}
  </section>;
}
