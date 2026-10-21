'use client';
import React from 'react';
import type {ReviewRow} from '@/domain/contact-review';
const labels:Record<string,string>={current_claim:'原文声明现职，仍需核实',former_claim:'历史任职',timing_unknown:'任职时间未知'};
export function ContactPath({kind,value}:{kind:string;value:string}){
  const label=({social:'社媒账号',phone:'公开电话',whatsapp:'WhatsApp',contact_page:'联系页面',email:'邮箱'} as Record<string,string>)[kind]||kind;
  let href='';try{const u=new URL(value);if((u.protocol==='https:'||kind==='contact_page'&&u.protocol==='http:')&&!u.username&&!u.password)href=u.href;}catch{}
  if(kind==='phone'&&/^[+()\d][\d ()+.-]{6,30}$/.test(value))href='tel:'+value.replace(/[ ()-]/g,'');
  if(kind==='whatsapp'&&/^\+?\d{7,15}$/.test(value))href='https://wa.me/'+value.replace(/^\+/,'');
  return <span>{label}：{href?<a href={href} target="_blank" rel="noreferrer">{value}</a>:value}</span>;
}
export function ContactPersonDetails({row}:{row:ReviewRow}){
  return <div aria-label={`${row.name}职业经历`}>
    <p>任职企业原文：{row.employerClaim||'未取得'}</p>
    <p>任职日期原文：{row.employmentDates?.join('、')||'未知'}</p>
    <details><summary>职业经历（{row.careerHistory?.length||0} 条）</summary>
      {!row.careerHistory?.length&&<p>尚无可明确关联姓名的完整职业经历；人物仍保留。</p>}
      {row.careerHistory?.map((job,i)=><article key={i}><p>{labels[job.status]||job.status}：{job.employer} · {job.title||'职位未知'} · {job.period||'任职日期未知'}</p>
        <p>来自公开资料的声明；发布日期与采集日期不能证明当前任职。</p>
        {job.evidence.map((e,k)=><p key={k}><a href={e.sourceUrl} target="_blank" rel="noreferrer">经历来源</a> · 发布：{e.publishedAt||'未知'} · 获取：{e.retrievedAt||'未知'}<br/>{e.quote}</p>)}
      </article>)}
    </details>
    {[...(row.detailUnknowns||[]),...(row.careerUnknowns||[])].map((v,i)=><p key={i}>{v}</p>)}
  </div>;
}
export function ContactPersonChannels({row}:{row:ReviewRow}){
  return <>
    {row.profileUrl&&<a href={row.profileUrl} target="_blank" rel="noreferrer">个人资料链接</a>}
    {row.personChannels?.map((c,i)=><p key={i}><ContactPath kind={c.kind} value={c.value}/> · 个人归属及有效性待核实</p>)}
    {!row.personChannels?.length&&<p>尚无公开个人联络渠道；可以查看来源链接，姓名和职位继续保留。</p>}
  </>;
}
