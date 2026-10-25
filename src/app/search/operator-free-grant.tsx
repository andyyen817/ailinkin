'use client';
import {useState,type FormEvent} from 'react';
export function OperatorFreeGrant({busy,owner,onAuthorize}:{busy:boolean;owner:boolean;onAuthorize:(grant:any)=>void}){
  const [limits,setLimits]=useState({pages:2,finder:4,verify:2,prospeoCredits:7,hunterCredits:1,minutes:60});
  const change=(key:keyof typeof limits,value:string)=>setLimits(old=>({...old,[key]:Number(value)}));
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget),number=(key:string)=>Number(form.get(key));
    onAuthorize({pages:number('pages'),finder:number('finder'),verify:number('verify'),prospeoCredits:number('prospeoCredits'),hunterCredits:number('hunterCredits'),minutes:number('minutes'),consent:form.has('consent')});
  }
  return <form onSubmit={submit} className="operator-confirm"><h3>先做一小批，看看效果</h3>
    <p>系统先找企业候选，你再选企业查联系人。这里只设置本批上限；查不到就记录原因，已有结果直接复用。</p>
    <fieldset disabled={busy||!owner}><div className="operator-options">
      <label>查几家企业的联系人<input name="pages" type="number" min="1" max="10" value={limits.pages} onChange={e=>change('pages',e.target.value)} required/></label>
      <label>最多补几人的工作邮箱<input name="finder" type="number" min="0" max="100" value={limits.finder} onChange={e=>change('finder',e.target.value)} required/></label>
      <label>最多独立验证几个邮箱<input name="verify" type="number" min="0" max="20" value={limits.verify} onChange={e=>change('verify',e.target.value)} required/></label>
    </div><p>本批最多取得25家企业候选，再选最多 {limits.pages} 家查人；不保证每家都能找到邮箱。</p>
    <details><summary>高级：来源积分与时间上限</summary><div className="operator-options">
      <label>Prospeo免费积分上限<input name="prospeoCredits" type="number" min="1" max="100" value={limits.prospeoCredits} onChange={e=>change('prospeoCredits',e.target.value)} required/></label>
      <label>Hunter免费积分上限<input name="hunterCredits" type="number" min="0" max="10" step="0.5" value={limits.hunterCredits} onChange={e=>change('hunterCredits',e.target.value)} required/></label>
      <label>本批执行时间（分钟）<input name="minutes" type="number" min="5" max="60" value={limits.minutes} onChange={e=>change('minutes',e.target.value)} required/></label>
    </div><p>企业搜索1页，国家名称解析1次；每家人物搜索1页。账户前后核额共4次。岗位仅影响优先级。</p></details>
      <p>免费积分最多：Prospeo {limits.prospeoCredits}、Hunter {limits.hunterCredits}；最长 {limits.minutes} 分钟。余额不足自动缩减，无法确认免费即停止。现金支出 ¥0。</p>
      <label><input name="consent" type="checkbox" required/>我确认上述限额，仅用现有免费余额，现金支出0，不发信、不购买、不查手机。</label>
      <button className="primary" disabled={busy||!owner}>{busy?'正在保存并核对…':'核对免费额度，查看可执行数量 →'}</button>
    </fieldset>
  </form>;
}
