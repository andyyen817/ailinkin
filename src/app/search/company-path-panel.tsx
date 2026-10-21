'use client';
import {useEffect,useState} from 'react';
const names:Record<string,string>={hunter_domain:'Hunter 企业联系人',prospeo_company:'Prospeo 公司渠道',prospeo_people:'Prospeo 关联人物',account_hunter:'Hunter 免费额度',account_prospeo:'Prospeo 免费额度'};
const states:Record<string,string>={reserved:'已登记，结果待核对',received:'已收到资料',failed:'来源未返回可用资料',unknown:'结果未知，停止重复调用'};
export function CompanyPathPanel({tenantId,campaignId,companies,owner}:{tenantId:string;campaignId:string;companies:any[];owner:boolean}){
  const [data,setData]=useState<any>(null),[companyId,setCompanyId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const base=`/api/v1/tenants/${tenantId}/company-contact-paths`;
  useEffect(()=>{let live=true;setCompanyId(companies[0]?.id||'');setData(null);void fetch(`${base}?campaignId=${campaignId}`).then(async r=>{if(!r.ok)throw Error('无法读取联系人来源批次，请检查企业权限。');return r.json();}).then(d=>{if(live)setData(d);}).catch(e=>{if(live)setMessage(e.message);});return()=>{live=false;};},[base,campaignId,companies.map(c=>c.id).join(',')]);
  async function run(action:'check_accounts'|'discover'){
    setBusy(true);setMessage('正在核对来源并保存结果，请保留页面。');try{
      const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,campaignId,...(action==='discover'?{companyId}:{})})}),d=await response.json();
      if(!response.ok)throw Error(d.error==='COMPANY_PATH_SCOPE_REQUIRED'?'本批来源授权已结束，已保存资料保留。':d.error==='COMPANY_PATH_SELECTION_REQUIRED'?'请先确认需要深度研究的企业名单。':'本次未完成，请查看已保存结果后再继续。');
      setData(d);setMessage(action==='check_accounts'?'免费额度核查已保存。':'本企业来源已处理；没有取得的资料仍为未知，请在下方销售表判断。');window.dispatchEvent(new Event('contact-batch-updated'));
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  const enabled=owner&&data?.enabled&&!busy,page=data?.unreadPages?.[companyId];
  return <section className="contact-review" aria-label="企业联系人数据来源" aria-busy={busy}>
    <h2>按企业补充人物与联系渠道</h2><p>查询已确认企业的关联人物、职业经历、个人公开账号及公司公共渠道，保存出处后交给销售判断。来源中的个人邮箱候选仍需单独验真。</p>
    <label>补查企业<select value={companyId} onChange={e=>setCompanyId(e.target.value)} disabled={busy}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="search-actions"><button disabled={!enabled||(data?.budget?.accountCalls||0)>=4} onClick={()=>void run('check_accounts')}>核实免费额度</button><button disabled={!enabled||!companyId||!!data?.unreadPages&&!page||!Object.keys(data?.accounts||{}).length} onClick={()=>void run('discover')}>{page?`采集本企业第${page}页新人物`:'补充本企业人物与渠道'}</button></div>
    {data?.unreadPages&&<p>本批仅采集已批准企业的第2页，最多2页／50条候选资料；已保存人物会去重，邮箱另按新人物限额补查。</p>}
    <p role="status">{message||(!data?.enabled?'当前未开放真实来源批次；已有联系人资料仍保留。':'先核实免费额度，再补查选定企业。')}</p>
    {Object.values(data?.accounts||{}).map((a:any)=><p key={a.provider}>{a.provider==='hunter'?'Hunter':'Prospeo'}：{a.plan||'套餐未知'}，剩余 {Number.isFinite(a.remaining)?a.remaining:'未知'} 积分。</p>)}
    {data?.budget&&<p>本批页面已预留 Hunter {data.budget.hunterReserved}/{data.unreadPages?0:6} 积分、Prospeo {data.budget.prospeoReserved}/{data.unreadPages?2:6} 积分；额度核查 {data.budget.accountCalls}/4 次。{data.budget.expiresAt&&<>截止 {new Date(data.budget.expiresAt).toLocaleTimeString()}。</>}</p>}
    <div>{(data?.calls||[]).map((c:any,i:number)=><article key={i}><strong>{c.companyName||'批次'} · {names[c.action]||'资料来源'}</strong><p>{states[c.state]||'状态待核对'}；人物 {c.people??0}，个人渠道 {c.personalChannels??0}，公司渠道 {c.companyChannels??0}。</p>{Number.isFinite(c.sourceTotal)&&<p>本来源匹配 {c.sourceTotal} 条；本轮读取第{c.page||1}页，去重 {c.duplicates||0} 条，不代表已查完。</p>}{c.reason&&<details><summary>查看来源结果</summary><p>{c.reason}</p></details>}</article>)}</div>
    {!!data?.notExecuted?.length&&<details><summary>未执行步骤与缺项</summary>{data.notExecuted.map((v:any,i:number)=><p key={i}>{names[v.action]}：{v.reason==='COMPANY_PATH_FREE_QUOTA_REQUIRED'?'免费额度或套餐资格尚未核实':v.reason==='COMPANY_PATH_SOURCE_PAUSED'?'本批来源已暂停，原失败记录保留':v.reason}</p>)}</details>}
    <p>重复的已完成请求优先复用；失败或未知结果保留。本入口不发送邮件。</p>
  </section>;
}
