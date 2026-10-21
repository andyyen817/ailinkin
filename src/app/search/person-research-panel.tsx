'use client';
import {useEffect,useState} from 'react';
import {ContactStandardPanel} from './contact-standard-panel';
import type {ReviewRow} from '@/domain/contact-review';
import {personFields,canResumeSavedPersonBatch,type PersonField} from '@/domain/person-research';
export function togglePersonId(ids:string[],id:string,checked:boolean){return checked?[...new Set([...ids,id])]:ids.filter(p=>p!==id);}
const labels:Record<PersonField,string>={career:'现任与历史职位',profile:'个人公开账号',work_email:'工作邮箱',public_phone:'公开电话／WhatsApp'};
const states:Record<string,string>={prepared:'等待启动',queued:'已排队',running:'后台补查中',paused:'已暂停',done:'本批已结束，仍可能有缺项',blocked:'已停止，需查看原因',pending:'待处理',reserved:'执行中',failed:'失败，记录保留',unknown:'结果未知，禁止自动重发'};
export function PersonResearchPanel({tenantId,campaignId,rows,owner,dirty}:{tenantId:string;campaignId:string;rows:ReviewRow[];owner:boolean;dirty:boolean}){
  const [data,setData]=useState<any>(null),[selected,setSelected]=useState<string[]>([]),[fields,setFields]=useState<PersonField[]>([...personFields]);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const base=`/api/v1/tenants/${tenantId}/person-research`;
  function adopt(d:any){setData(d);setSelected(d.selection?.personIds||[]);setFields(d.selection?.fields||[...personFields]);}
  async function load(){const r=await fetch(`${base}?campaignId=${campaignId}`),d=await r.json();if(!r.ok)throw Error(d.message||'人物补查暂不可用，请稍后刷新。');adopt(d);}
  useEffect(()=>{let active=true;setData(null);setSelected([]);void fetch(`${base}?campaignId=${campaignId}`).then(async r=>{if(!r.ok)throw Error('人物补查尚未读取成功。');return r.json();}).then(d=>{if(active)adopt(d);}).catch(e=>{if(active)setNotice(e.message);});return()=>{active=false;};},[base,campaignId]);
  const running=data?.batches?.some((b:any)=>['queued','running'].includes(b.state));
  useEffect(()=>{if(!running)return;let active=true;const timer=setInterval(()=>{void fetch(`${base}?campaignId=${campaignId}`).then(r=>r.ok?r.json():null).then(d=>{if(active&&d){setData(d);window.dispatchEvent(new Event('contact-batch-updated'));}}).catch(()=>{if(active)setNotice('进度暂时读取失败，后台结果保留，请稍后刷新。');});},3000);return()=>{active=false;clearInterval(timer);};},[base,campaignId,running]);
  async function action(action:string,batchId?:string){setBusy(true);try{
    const payload={campaignId,action,...(action==='save_selection'?{personIds:selected,fields,expectedVersion:data?.selection?.version||null}:{}),...(batchId?{batchId}:{})};
    const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json();
    if(!r.ok)throw Error(d.message||d.error||'未完成，已保存资料仍保留。');adopt(d);setNotice(action==='save_selection'?'补查人物已保存；销售判断与邮件选择保持独立。':action==='start'||action==='resume'?'已交给后台；页面仅查看进度。':'补查计划已保存。');
  }catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}
  const people=rows.filter(r=>r.kind==='person'&&r.personId),changed=JSON.stringify([...selected].sort())!==JSON.stringify([...(data?.selection?.personIds||[])].sort())||JSON.stringify([...fields].sort())!==JSON.stringify([...(data?.selection?.fields||personFields)].sort());
  const limit=data?.execution.maxPeople||6,reachedLimit=limit===6?selected.length>=6:selected.length>=limit;
  const needsConfirmation=!!data?.selection&&!data.valid;
  return <section className="person-research" aria-label="补查人物与联络方式"><h3>补查人物与联络方式</h3>
    <p>先选企业，再勾选人物。姓名筛选只改变显示，隐藏的勾选仍保留。本批最多 {data?.execution.maxPeople||6} 人，不要求采购职位。</p>
    <p role="status">{notice}</p><p>已勾选 {selected.length} 人；当前显示 {people.length} 人。</p>
    {people.map(p=><label className="person-research-choice" key={p.personId}><input type="checkbox" aria-label={`补查 ${p.name}`} checked={selected.includes(p.personId!)} disabled={!owner||busy||dirty||!data||(!selected.includes(p.personId!)&&reachedLimit)} onChange={e=>setSelected(old=>togglePersonId(old,p.personId!,e.target.checked))}/>{p.companyName} · {p.name} · {p.title||'职位待核实'}</label>)}
    <fieldset disabled={!owner||busy||dirty}><legend>需要补充的资料</legend>{personFields.map(f=><label key={f}><input type="checkbox" checked={fields.includes(f)} onChange={e=>setFields(old=>e.target.checked?[...old,f]:old.filter(v=>v!==f))}/>{labels[f]} </label>)}</fieldset>
    {dirty&&<p>请先保存上方销售判断，再操作补查。</p>}
    {needsConfirmation&&<p>人物资料已有变化，请按当前资料重新确认；原选择、历史与销售备注仍保留。</p>}
    <button disabled={!owner||busy||dirty||!data||(!changed&&!needsConfirmation)||!fields.length} onClick={()=>void action('save_selection')}>{needsConfirmation&&!changed?'按当前资料重新确认':'保存补查人物'}</button>
    {selected.some(id=>!data?.people?.some((p:any)=>p.personId===id))&&<button disabled={!owner||busy||dirty} onClick={()=>setSelected(old=>old.filter(id=>data.people.some((p:any)=>p.personId===id)))}>移除已不在名单的人物</button>}
    <button disabled={!owner||busy||dirty||changed||!selected.length||!data?.valid} onClick={()=>void action('prepare')}>预览补查计划</button>
    <button disabled={busy||dirty} onClick={()=>void load().catch(e=>setNotice(e.message))}>刷新逐人结果</button>
    {!data?.execution.enabled&&<p>真实补查当前未开放，已保存名单和计划仍可查看。需要有效来源及本批额度后才能执行。</p>}
    <details><summary>当前资料来源</summary>{data?.capabilities?.length?data.capabilities.map((c:any)=><p key={c.id}>{c.provider} · {c.available?'本端点可用':'本端点未开放'} · {c.notice}</p>):<p>尚无本批可用来源配置；可保存人物选择和查看缺项，不会自动消耗接口。</p>}</details>
    {!selected.length&&<details><summary>没有完整姓名？先按企业发现人物</summary>{data?.companies?.map((c:any)=><button key={c.id} disabled={!owner||busy||dirty} onClick={()=>{setBusy(true);void fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaignId,action:'prepare',companyIds:[c.id]})}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.message||d.error);adopt(d);setNotice('企业人物发现计划已保存，尚未发起查询。');}).catch(e=>setNotice(e.message)).finally(()=>setBusy(false));}}>预览 {c.name} 人物发现</button>)}</details>}
    {data?.execution.limits&&<p>整批共享上限：邮箱补全 {data.execution.limits.finder||0} 次、邮箱验证 {data.execution.limits.verifications||0} 次；免费查询 {data.execution.limits.searches} 次、公开页 {data.execution.limits.pages} 页、模型 {data.execution.limits.models} 次／US${data.execution.limits.usd}。Apollo资格另行核实。</p>}
    {data?.batches?.map((b:any)=><article key={b.id} aria-label={`人物补查批次 ${b.id}`}><h4>{states[b.state]||b.state}</h4><p>{b.notice}</p>
      <p>预留用量：邮箱补全 {b.usage.finder||0}，邮箱验证 {b.usage.verifications||0}，查询 {b.usage.searches}，页面 {b.usage.pages}，网页请求 {b.usage.network}，模型 {b.usage.models}／US${b.usage.usd}，Apollo {b.usage.apollo} 积分。失败与未知仍计入预留。</p>
      <button disabled={!owner||busy||dirty||changed||needsConfirmation&&!canResumeSavedPersonBatch(b,data.selection?.id)&&!b.steps.some((s:any)=>s.state==='done'&&(s.kind==='verify'&&s.result?.technical?.pending||s.kind==='finder'&&s.result?.state==='provider_pending'))||b.selectionId!==data.selection?.id&&b.selectionId!=='discovery'||!data.execution.enabled||!(['prepared','paused'].includes(b.state)||b.state==='done'&&b.steps.some((s:any)=>s.result?.state==='provider_pending'))} onClick={()=>void action(b.state==='prepared'?'start':'resume',b.id)}>{b.state!=='prepared'&&b.steps.some((s:any)=>s.result?.state==='provider_pending')?'继续检查原补全状态':b.state==='paused'&&b.steps.some((s:any)=>s.kind==='verify'&&s.result?.technical?.pending)?'继续检查原邮箱验证状态':'补查所选人物与联络方式'}</button>
      <button disabled={!owner||busy||!['queued','running'].includes(b.state)} onClick={()=>void action('pause',b.id)}>暂停本批补查</button>
      {b.people.map((p:any)=><details key={p.personId}><summary>{p.companyName} · {p.name} · {p.missing.map((f:PersonField)=>labels[f]).join('、')||'复用已有资料'}</summary>
        <p>{p.notice}；没有找到的资料保持未知，不等同于没有联系方式。</p>
        {b.steps.filter((s:any)=>s.personId===p.personId||s.input.personIds?.includes(p.personId)).map((s:any)=><div key={s.id}><p>{s.kind==='search'?'姓名查询':s.kind==='page'?'读取公开页':s.kind==='apollo'?'工作邮箱补查':'同企业资料分析'} · {states[s.state]||s.state} · {s.error||''}</p>
          {s.input.query&&<p>{s.input.query}</p>}{s.input.url&&<a href={s.input.url} target="_blank" rel="noreferrer">本次公开来源</a>}
          <p>执行路线：{({reuse:'复用资料',discover:'企业人物发现',finder:s.input.provider?'供应商邮箱补全':'公开邮箱查找',verify:'邮箱技术验证'} as any)[s.kind]||''}{s.input.provider?` · ${s.input.provider}`:''}</p>
          {s.result?.notice&&<p>{s.result.notice}</p>}{s.result?.reason&&<p>{s.result.reason}</p>}
          {s.kind==='search'&&Array.isArray(s.result)&&<p>返回 {s.result.length} 条；相关候选 {s.result.filter((h:any)=>h.admitted).length} 条。搜索摘要仅作线索。</p>}
          {s.result?.people?.map((v:any,i:number)=><p key={i}>{v.name} · {v.title||'职位未知'} · {(v.contacts||[]).map((c:any)=>`${c.scope==='person'?'个人候选':c.scope==='company'?'公司渠道':'归属未知'}：${c.value}`).join('；')||'没有取得个人联系方式；资料已保留'}</p>)}
        </div>)}
      </details>)}
    </article>)}
    <ContactStandardPanel view={data?.standard}/>
  </section>;
}
