'use client';
import type {FormEvent} from 'react';
export function OperatorFreeGrant({busy,owner,onAuthorize}:{busy:boolean;owner:boolean;onAuthorize:(grant:any)=>void}){
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget),number=(key:string)=>Number(form.get(key));
    onAuthorize({pages:number('pages'),finder:number('finder'),verify:number('verify'),prospeoCredits:number('prospeoCredits'),hunterCredits:number('hunterCredits'),minutes:number('minutes'),consent:form.has('consent')});
  }
  return <form onSubmit={submit} className="operator-confirm"><h3>设置本批免费限额</h3>
    <p>先核对两家账户实际免费余额，再显示本批可执行数量，由你确认开始。余额不足会缩减，无法确认免费就停止。</p>
    <fieldset disabled={busy||!owner}><div className="operator-options">
      <label>最多查联系人企业数<input name="pages" type="number" min="1" max="10" defaultValue="2" required/></label>
      <label>最多补邮箱人数<input name="finder" type="number" min="0" max="100" defaultValue="4" required/></label>
      <label>最多验证新邮箱<input name="verify" type="number" min="0" max="20" defaultValue="2" required/></label>
      <label>Prospeo免费积分上限<input name="prospeoCredits" type="number" min="1" max="100" defaultValue="7" required/></label>
      <label>Hunter免费积分上限<input name="hunterCredits" type="number" min="0" max="10" step="0.5" defaultValue="1" required/></label>
      <label>本批执行时间（分钟）<input name="minutes" type="number" min="5" max="60" defaultValue="60" required/></label>
    </div><p>企业搜索1页（最多25家候选），国家名称解析1次；每家人物搜索1页。账户前后核额共4次。岗位仅影响优先级。</p>
      <label><input name="consent" type="checkbox" required/>我确认上述限额，仅用现有免费余额，现金支出0，不发信、不购买、不查手机。</label>
      <button disabled={busy||!owner}>保存免费限额并核对余额</button>
    </fieldset>
  </form>;
}
