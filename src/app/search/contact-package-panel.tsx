'use client';
import {useEffect,useState} from 'react';
export function ContactPackagePanel({tenantId,campaignId,companies,owner}:{tenantId:string;campaignId:string;companies:any[];owner:boolean}){
  const [packages,setPackages]=useState<any[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const base=`/api/v1/tenants/${tenantId}/contact-packages`,eligible=companies.filter(c=>c.qualification?.status==='qualified').slice(0,3);
  useEffect(()=>{let live=true;setPackages([]);setMessage('');void fetch(`${base}?campaignId=${campaignId}`).then(async r=>{
    if(!r.ok)throw Error('读取联系资料失败');const data=await r.json();if(live)setPackages(data.packages);
  }).catch(e=>{if(live)setMessage(e.message);});return()=>{live=false;};},[base,campaignId]);
  async function prepare(){
    setBusy(true);setMessage('正在复用已保存官网资料');
    try{const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepare',campaignId,companyIds:eligible.map(c=>c.id)})});
      const data=await r.json();if(!r.ok)throw Error('联系包未保存，请核对企业权限、官网依据和当前业务资料。');setPackages(data.packages);setMessage('联系路径、负责人核实情况与三封首信已保存；外部调用 0 次，发送 0 封。');
    }catch(e){setMessage(e instanceof Error?e.message:'未完成');}finally{setBusy(false);}
  }
  return <section className="search-panel" aria-label="客户联系与首信准备"><h2>客户联系与首信准备</h2>
    <p>先复用已保存官网，核对公司联系入口；具体采购负责人和邮箱可用性分别记录。</p>
    <button disabled={!owner||busy||!eligible.length} onClick={()=>void prepare()}>整理已保存联系路径与首信草稿</button>
    <p role="status">{message}</p><p>联系包 {packages.length} 家 · 已确认采购负责人 {packages.reduce((n,p)=>n+p.review.confirmedProcurementPeople,0)} 人 · 已发送 0 封</p>
    {packages.map(p=><article className="discovery-evidence" key={p.companyId}><h3>{p.name}</h3><p>负责人：{p.review.status} · 采购权限及意愿未确认</p><p>建议核实岗位：{p.review.suggestedRoles.join('、')}</p>
      <details open><summary>官网公开联系路径</summary>{p.routes.map((r:any)=><div key={r.id}><p>{r.kind==='email'?'企业公共邮箱':r.kind==='phone'?(r.scope==='store'?'门店电话':'官网公司电话'):'官方联系页入口'}：{r.value}</p><a href={r.sourceUrl} target="_blank" rel="noreferrer">官网出处 ↗</a><small>{r.status} · 原文：{r.quote}{r.kind==='contact_page'?' · 表单提交及采购转介尚未验证':''}{r.kind==='email'?' · 独立邮箱验证未执行':''}</small></div>)}</details>
      <details open><summary>个性化首信 · 待审核</summary><p>主题：{p.draft.subjects[0]}</p><pre>{p.draft.first}</pre><small>{p.draft.method}</small><a href={p.draft.source.url} target="_blank" rel="noreferrer">首信事实出处 ↗</a></details>
      <p>发信前仍需：{p.draft.blockers.join('；')}。</p><button disabled>真实发信尚未就绪</button>
    </article>)}
  </section>;
}
