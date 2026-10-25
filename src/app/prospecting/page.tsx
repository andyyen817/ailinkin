'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {OperatorBatchPanel} from '../search/operator-batch-panel';
import '../search/search.css';
import '../profiles/profiles.css';
import './prospecting.css';
const countryNames:Record<string,string>={'泰国':'Thailand','印尼':'Indonesia','菲律宾':'Philippines','越南':'Vietnam','马来西亚':'Malaysia','新加坡':'Singapore','印度':'India','美国':'United States','英国':'United Kingdom','澳大利亚':'Australia','日本':'Japan','德国':'Germany'};
const split=(text:string)=>text.split(/[,，\n]/).map(v=>v.trim()).filter(Boolean);
function queryKeywords(type:string){
  for(const [pattern,value] of [[/餐饮|餐厅/,'restaurant'],[/咖啡/,'coffee'],[/酒店/,'hotel'],[/医院/,'hospital'],[/经销|分销/,'distributor']] as const)if(pattern.test(type))return [value];
  return [type];
}
export default function Prospecting(){
  const [tenant,setTenant]=useState(''),[owner,setOwner]=useState(false),[rows,setRows]=useState<any[]>([]),[selected,setSelected]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[loaded,setLoaded]=useState(false);
  const [showNew,setShowNew]=useState(false);
  async function load(id:string){
    const r=await fetch(`/api/v1/tenants/${id}/prospecting`,{cache:'no-store'});
    if(r.status===401){location.assign('/login');return;}
    if(!r.ok)throw Error('无法读取获客任务，请检查企业权限。');
    const data=await r.json();setRows(data.directions);setOwner(data.owner);setLoaded(true);
    setSelected(old=>old||new URLSearchParams(location.search).get('campaignId')||data.directions[0]?.id||'');
  }
  useEffect(()=>{const id=new URLSearchParams(location.search).get('tenantId')||'';setTenant(id);if(id)void load(id).catch(e=>setMessage(e.message));else setMessage('请从企业工作台选择企业后进入。');},[]);
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setBusy(true);setMessage('正在保存新方向…');
    const form=new FormData(event.currentTarget),value=(key:string)=>String(form.get(key)||'').trim();
    const country=countryNames[value('country')]||value('country'),customerType=value('customerType');
    const body={name:`${value('country')} · ${customerType}`,product:value('product'),country,customerType,
      keywords:value('keywords')?split(value('keywords')):queryKeywords(customerType),roles:split(value('roles'))};
    try{
      const r=await fetch(`/api/v1/tenants/${tenant}/prospecting`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await r.json();
      if(!r.ok)throw Error(data.error==='OWNER_REQUIRED'?'请企业负责人创建并确认采集限额。':'方向未保存，请检查产品、国家、客户类型及关键词（每项至少3个字符）。');
      await load(tenant);setSelected(data.id);setShowNew(false);
      history.replaceState(null,'',`/prospecting?tenantId=${tenant}&campaignId=${data.id}`);
      setMessage('方向已保存。下一步确认本批免费限额，再核实来源余额。');
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  const current=rows.find(r=>r.id===selected);
  return <main className="workspace search-page prospecting-page">
    <header><a className="brand" href="/workspace">客户开发工作台</a><nav><a href={`/contacts?tenantId=${tenant}`}>客户库与下载</a><details className="novice-more"><summary>更多</summary><a href={`/profiles?tenantId=${tenant}`}>产品资料</a><a href={`/search?tenantId=${tenant}`}>高级搜索与研究</a></details></nav></header>
    <section className="workspace-intro"><span className="eyebrow">找客户</span><h1>选好方向，开始找客户</h1><p>填写目标 → 核对免费额度 → 查找联系人 → 审核入库与下载</p><span className="badge">仅用现有免费额度 · 暂不发信</span></section>
    {message&&<p role="status" className="form-message">{message}</p>}
    {loaded&&rows.length>0&&<section className="prospecting-switcher"><label>我的找客任务<select value={selected} onChange={e=>{setSelected(e.target.value);setShowNew(false);history.replaceState(null,'',`/prospecting?tenantId=${tenant}&campaignId=${e.target.value}`);}}>{rows.map(r=><option value={r.id} key={r.id}>{r.direction.name}</option>)}</select></label><button disabled={busy||!owner} onClick={()=>setShowNew(v=>!v)}>{showNew?'返回当前任务':'＋ 新建方向'}</button><button disabled={busy} onClick={()=>void load(tenant).catch(e=>setMessage(e.message))}>刷新任务</button></section>}
    {(showNew||loaded&&!rows.length)&&<form className="profile-panel direction-form" onSubmit={create}>
      <h2>你想找什么客户？</h2><fieldset disabled={busy||!owner||!loaded}><div className="direction-fields">
        <label>产品／服务<input name="product" required maxLength={200} placeholder="例如：连锁门店RO净水系统"/></label>
        <label>国家<input name="country" required maxLength={100} list="prospecting-countries" placeholder="例如：泰国"/></label>
        <datalist id="prospecting-countries">{Object.keys(countryNames).map(c=><option key={c} value={c}/>)}</datalist>
        <label>客户类型<input name="customerType" required maxLength={100} placeholder="例如：餐饮连锁"/></label>
        </div><details className="novice-advanced"><summary>岗位与搜索词（选填，默认不限岗位）</summary><label>岗位偏好（选填）<input name="roles" maxLength={500} placeholder="留空查所有岗位；填写仅优先排序"/></label><label>英文检索关键词<textarea name="keywords" rows={2} placeholder="留空使用客户类型；如 restaurant, food service"/></label></details>
        <p className="muted">地区按企业总部筛选；当地门店、采购意向还需核实。找到的企业不等于已成交客户。</p>
        <button className="primary" disabled={busy||!owner}>{busy?'正在保存…':'保存方向，下一步 →'}</button>
      </fieldset>{loaded&&!owner&&<p>成员可查看结果；创建及确认采集由企业负责人操作。</p>}
    </form>}
    {!showNew&&current&&<><section className="direction-summary"><h2>{current.direction.name}</h2><p>{current.direction.product} · 岗位{current.direction.roles.length?`偏好：${current.direction.roles.join('、')}`:'不限'}</p></section><OperatorBatchPanel key={current.id} tenantId={tenant} campaignId={current.id} owner={owner}/></>}
    {!loaded&&!message&&<p role="status">正在读取已保存任务…</p>}
  </main>;
}
