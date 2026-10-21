'use client';
import React,{useState} from 'react';
const filters:Record<string,string>={all:'全部结果',verified:'邮箱已验证，归属待核',conflict:'邮箱归属冲突',candidate:'邮箱尚未确认',profile:'只有个人主页',missing:'未找到个人渠道',excluded:'请勿联系'};
export function ContactBatchResults({summary,company,disabled,onFinish}:{summary:any;company:string;disabled:boolean;onFinish:()=>void}){
  const [status,setStatus]=useState('all');if(!summary)return null;
  const current=company?summary.companies?.[company]||summary:summary,counts=current.counts;
  const people=current.people.filter((p:any)=>status==='all'||p.code===status);
  const companyIds=[...new Set(current.people.map((p:any)=>p.companyId))],saved=(summary.completions||[]).filter((b:any)=>!b.stale);
  const complete=companyIds.length>0&&companyIds.every(id=>saved.some((b:any)=>b.companyIds.includes(id)));
  const completed=complete?[...saved].reverse().find((b:any)=>b.companyIds.some((id:string)=>companyIds.includes(id))):undefined;
  return <section className="contact-batch-results" aria-label="整批联系结果">
    <h3>整批联系结果</h3>
    <div className="contact-result-counts">{[['人物记录',counts.personRecords],['个人主页',counts.personalProfiles],['不同候选邮箱',counts.candidateEmails],['邮箱技术验证通过',counts.validEmails],['归属冲突邮箱',counts.sharedEmails],['个人号码',counts.personalPhones]].map(([label,value])=><p key={label}><strong>{value}</strong><span>{label}</span></p>)}</div>
    <p>人物记录尚未完全确认或合并。邮箱技术验证通过后，仍需核对属于谁。个人渠道未找到 {counts.missingRecords} 条；仅有主页 {counts.profileOnlyRecords} 条。</p>
    <p>公司公共渠道：{counts.companySocialAccounts} 个社媒账号、{counts.companyEmails} 个邮箱、{counts.companyPhones} 个号码候选、{counts.companyContactPages} 个联系页面。</p>
    <button disabled={disabled} onClick={onFinish}>完成本批整理（复用已有结果）</button>
    {completed?<p role="status">本批结果已保存：{new Date(completed.completedAt).toLocaleString('zh-CN')}。本次新增查询 {completed.externalRequests} 次、来源积分 {completed.providerCredits}、发信 {completed.sent} 封。</p>:<p>整理会逐人保存结果和缺项原因。已有采集资料继续复用；不会重新查询供应商。</p>}
    <label>联系结果筛选 <select value={status} onChange={e=>setStatus(e.target.value)}>{Object.entries(filters).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
    <div className="contact-review-scroll contact-result-scroll"><table><caption>当前显示 {people.length}／{current.people.length} 条人物记录。筛选不会删除资料。</caption>
      <thead><tr><th>企业／姓名</th><th>个人邮箱</th><th>个人主页／号码</th><th>当前结果及原因</th><th>下一步</th></tr></thead>
      <tbody>{people.map((p:any)=><tr key={p.rowId} data-outcome={p.code}>
        <td data-label="企业／姓名"><strong>{p.name}</strong><br/>{p.companyName}<br/>{p.title}</td>
        <td data-label="个人邮箱"><span className="contact-lines">{p.email}</span><small className="contact-lines">{p.emailState}</small></td>
        <td data-label="个人主页／号码">{p.profiles==='未找到'?<span>个人主页未找到</span>:p.profiles.split('\n').map((url:string)=><p key={url}><a href={url} target="_blank" rel="noreferrer">打开个人主页</a></p>)}<small className="contact-lines">{p.phone==='未找到'?'个人号码未找到':p.phone}</small></td>
        <td data-label="当前结果及原因"><strong>{p.status}</strong><p>{p.reason}</p>{p.duplicateNotice&&<p>{p.duplicateNotice}</p>}</td>
        <td data-label="下一步">{p.nextAction}</td>
      </tr>)}</tbody>
    </table></div>{!people.length&&<p>当前条件没有人物记录，可切换其他联系结果。</p>}
  </section>;
}
