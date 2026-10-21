'use client';
import {useState} from 'react';
const states:Record<string,string>={unknown:'未知',pending:'待执行',expired:'已过期',valid:'技术有效',invalid:'无效',catch_all:'接收全部地址，待核实',unverified:'未验证',done:'已执行',failed:'失败',skipped:'未发送',reserved:'结果待核对',person:'个人候选',company:'公司',store:'门店',other_employer:'其他雇主',current_claim:'现任声明',former_claim:'历史任职声明',former_employee:'前员工',current_employee:'现任声明待核实',founder:'创始关系提及',partner:'合作方',mentioned:'仅被提及',restricted:'入口受限',blocked:'已停止',qualification_unverified:'接口资格未核实',domain_unverified:'邮件域名未核实',not_found:'本来源未找到',ownership_needs_review:'公开渠道，归属待核实',provider_work_email_candidate:'供应商邮箱候选',provider_company_phone:'供应商公司电话',format_only:'仅格式检查',provider_candidate:'供应商归属候选',same_line_claim:'同段原文提及',needs_review:'待人工核实',search:'网页查询',page:'公开页读取',model:'资料整理',reuse:'复用资料',apollo:'人物匹配',discover:'企业人物发现',finder:'公开邮箱查找',verify:'邮箱验证'};
export function ContactStandardPanel({view}:{view:any}){
  const [tab,setTab]=useState('people'),[filter,setFilter]=useState('all');if(!view)return null;
  const label=(v:string)=>states[v]||v||'未知';
  return <section aria-label="标准联系人结果"><h3>人物与联系渠道</h3>
    <div role="tablist" aria-label="联系人结果视图">{[['people','人物表'],['channels','联系渠道表'],['coverage','来源覆盖与缺项']].map(([id,name])=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}>{name}</button>)}</div>
    {tab==='people'&&<><label>联系资料筛选 <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部人物</option><option value="has">已有个人联系路径</option><option value="missing">尚缺个人联系路径</option></select></label>
      {view.people.filter((p:any)=>filter==='all'||(filter==='has'?p.channelCount>0:p.channelCount===0)).map((p:any)=><details key={p.rowId}><summary>{p.companyName} · {p.name} · {p.channelCount} 条个人渠道</summary><p>{p.title||'职位未知'}；企业关系：{label(p.relationship)}；缺项：{p.missing.join('、')||'所选资料已有依据'}</p>{p.careers.map((c:any,i:number)=><p key={i}>{c.employer} · {c.title} · {c.period||'日期未知'} · {label(c.status)}</p>)}</details>)}</>}
    {tab==='channels'&&<>{view.channels.length===0?<p>本批尚未取得新渠道，人物资料仍保留。</p>:view.channels.map((c:any)=><details key={c.rowId}><summary>{c.companyName} · {c.name||'未绑定个人'} · {c.value}</summary><p>归属：{label(c.scope)}；归属依据：{c.ownership}；雇主：{c.employer||'未知'}；技术状态：{label(c.technicalState)}</p><p>请求时间：{c.technical?.requestedAt||'未验证'}；实际验证日期：{c.technical?.verifiedAt||'供应商未提供'}；有效期：{c.technical?.expiresAt||'未知'}</p>{c.evidence.map((e:any,i:number)=><a key={i} href={e.sourceUrl} target="_blank" rel="noreferrer">查看来源 {i+1} </a>)}</details>)}</>}
    {tab==='coverage'&&<>{view.coverage.length===0?<p>尚未建立补查计划；不代表各平台已完成。</p>:view.coverage.map((c:any,i:number)=><p key={i}>{label(c.source)} · {label(c.state)} · {c.reused?'复用已有资料；':''}{c.reason||'仅代表本步骤状态'}</p>)}</>}
    <p>身份、任职、渠道归属与技术可用性分别判断。前员工保留；由销售选择实际联系对象。</p>
  </section>;
}
