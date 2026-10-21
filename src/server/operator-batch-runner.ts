import 'server-only';
import {randomUUID} from 'node:crypto';
import {assertOperatorScope,operatorKey,operatorUsage,executableOperatorLimits} from './operator-batch-policy';
import {operatorReservedCredits} from './operator-saved-people';
import {reuseOperatorOperation} from './operator-request-history';
import {nextEnrichmentOperation} from './contact-enrichment-runner';
const now=()=>new Date().toISOString();
function operation(batch:any,kind:string,input:any){return {id:randomUUID(),kind,...input,key:operatorKey(kind,input),state:'reserved',createdAt:now(),stages:[]};}
export function nextOperatorOperation(batch:any){
  if(batch.mode==='people_enrichment'&&['checking','enrichment'].includes(batch.state==='checking'?'checking':batch.stage))return nextEnrichmentOperation(batch);
  const receipts=batch.receipts;
  if(batch.state==='checking'){
    for(const provider of ['prospeo','hunter'])if(!receipts.some((r:any)=>r.kind==='account'&&r.slot==='before'&&r.provider===provider))return operation(batch,'account',{provider,slot:'before'});
    batch.limits=executableOperatorLimits(batch);batch.state='confirm';return null;
  }
  if(batch.state!=='running')return null;
  if(batch.selfService&&batch.stage==='companies'){
    if(!receipts.some((r:any)=>r.kind==='location'))return operation(batch,'location',{provider:'prospeo'});
    if(!batch.location){batch.reason='国家名称尚未确认，请使用英文国家名建立新方向。';batch.state='blocked';return null;}
    if(!receipts.some((r:any)=>r.kind==='company_search'))return operation(batch,'company_search',{provider:'prospeo'});
    if(batch.companyChoices?.length&&batch.limits.pages>0){batch.state='selecting';return null;}
    batch.stage='after';
  }
  if(batch.stage==='pages'){
    for(const t of batch.targets.slice(0,batch.limits.pages))if(!receipts.some((r:any)=>r.kind==='page'&&r.companyId===t.companyId))return operation(batch,'page',{provider:'prospeo',...t});
    const groups=batch.targets.map((t:any)=>batch.people.filter((p:any)=>p.companyId===t.companyId).sort((a:any,b:any)=>(b.rolePriority||0)-(a.rolePriority||0)));
    const ordered=[];for(let i=0;i<Math.max(0,...groups.map((g:any[])=>g.length));i++)for(const group of groups)if(group[i])ordered.push(group[i]);
    for(const [i,p] of ordered.entries()){p.selected=i<batch.limits.finder;p.status=p.selected?'等待补邮箱':'未查询';p.reason=p.selected?'等待自动处理':'本批免费补邮箱额度未覆盖，保留人物资料。';}
    batch.stage='finder';
  }
  if(batch.stage==='finder'){
    for(const p of batch.people.filter((p:any)=>p.selected))if(!receipts.some((r:any)=>r.kind==='finder'&&r.personKey===p.personKey))return operation(batch,'finder',{provider:'prospeo',personKey:p.personKey,companyId:p.companyId});
    batch.stage='verify';
  }
  if(batch.stage==='verify'){
    const emails=[...new Set<string>(batch.people.filter((p:any)=>p.email&&!p.technical&&!p.verificationHeld).map((p:any)=>p.email))];
    for(const email of emails)if(!receipts.some((r:any)=>r.kind==='verify'&&r.email===email)){
      if(receipts.filter((r:any)=>r.kind==='verify').length>=batch.limits.verify){for(const p of batch.people.filter((p:any)=>p.email===email)){p.status='邮箱待验证';p.reason='本批免费验证额度未覆盖，保留候选。';}continue;}
      return operation(batch,'verify',{provider:'hunter',email});
    }
    batch.stage='after';
  }
  if(batch.stage==='after'){
    for(const provider of ['prospeo','hunter'])if(!receipts.some((r:any)=>r.kind==='account'&&r.slot==='after'&&r.provider===provider))return operation(batch,'account',{provider,slot:'after'});
    batch.state='exporting';
  }
  return null;
}
export async function advanceOperatorBatch(batch:any,scope:any,rows:any[],execute:any,apply:any,save:any,exporter:any){
  if(batch.pauseRequested){batch.resumeState=batch.state;batch.state='paused';await save();return;}
  if(!['checking','running','exporting'].includes(batch.state))return;
  try{if(batch.state!=='exporting')assertOperatorScope(scope,scope.tenantId,batch.actorId);}catch(e){batch.state='blocked';batch.reason=(e as Error).message;await save();return;}
  if(batch.state!=='exporting'&&batch.confirmedAt&&Date.now()>=Date.parse(batch.sourceExpiresAt)){batch.state='blocked';batch.reason='采集窗口已结束；历史与回执保留，未继续调用。';await save();return;}
  for(const r of batch.receipts.filter((r:any)=>r.state==='reserved')){
    r.state='unknown';r.reason='执行中断，前次外部结果未知，禁止重发。';batch.failures++;(batch.disabledProviders||={})[r.provider]=r.reason;
  }
  let op:any;
  try{op=nextOperatorOperation(batch);}catch(e){batch.state='blocked';batch.reason=(e as Error).message;await save();return;}
  if(!op){
    if(batch.state==='exporting')try{batch.export=await exporter();batch.state='done';batch.finishedAt=now();batch.events.push({at:now(),message:'已保存结果并生成同页总表，可下载查看。'});}catch(e){batch.state='blocked';batch.reason='总表生成失败：'+(e as Error).message;batch.failures++;}
    await save();return;
  }
  if(batch.disabledProviders?.[op.provider]&&op.kind!=='account'){
    op.state='skipped';op.reason=batch.disabledProviders[op.provider];batch.receipts.push(op);await apply(op);await save();return;
  }
  if(await reuseOperatorOperation(op,batch,rows,(saved:any)=>apply(saved))){
    if(batch.mode==='people_enrichment'&&op.kind==='public_page')for(let reused=0;reused<97;reused++){
      const next=nextOperatorOperation(batch);
      if(!next||next.kind!=='public_page'||!await reuseOperatorOperation(next,batch,rows,(saved:any)=>apply(saved)))break;
    }
    await save();return;
  }
  const usage=operatorUsage(rows.flatMap(r=>r.data.operatorBatches||[]),scope.id),kind=op.kind==='account'?'accounts':op.kind==='page'?'pages':op.kind==='company_search'?'companies':op.kind==='location'?'locations':op.kind==='public_search'?'searches':['public_page','public_qualification'].includes(op.kind)?'publicPages':op.kind;
  if((usage[kind as keyof typeof usage]??0)>=scope.limits[kind]){batch.state='blocked';batch.reason='批准的免费次数已用完，未新增调用。';await save();return;}
  if(op.kind!=='account'&&!op.kind.startsWith('public_')){
    const a=batch.accounts?.[op.provider],all=rows.flatMap(r=>(r.data.operatorBatches||[]).filter((b:any)=>b.scopeId===scope.id).flatMap((b:any)=>b.receipts||[])),reserved=operatorReservedCredits(all,op.provider),ceiling=Math.min(a?.remaining??0,scope.credits?.[op.provider]??Infinity);
    if(!/^free$/i.test(a?.plan||'')||ceiling-reserved<(op.kind==='verify'?0.5:1)){batch.disabledProviders||={};batch.disabledProviders[op.provider]='免费余额或批准积分不足，停止该来源，保留其余进度。';await save();return;}
  }
  batch.receipts.push(op);await save();
  try{
    op.result=await execute(op,async(stage:any)=>{op.stages.push(stage);await save();});op.state='done';op.finishedAt=now();
    if(op.kind==='account'){
      if(op.slot==='before')(batch.accounts||={})[op.provider]=op.result;else(batch.finalAccounts||={})[op.provider]=op.result;
    }else await apply(op);
    if(op.kind==='finder'&&op.provider==='prospeo'){
      const headers=op.stages.findLast((s:any)=>s.rateHeaders)?.rateHeaders,left=headers&&Number(headers['x-daily-request-left']);
      if(Number.isInteger(left)&&left>=0){batch.currentDailyRemaining=left;if(left===0)(batch.disabledProviders||={}).prospeo='供应商每日免费请求已用完；其余人物保留未查询，等待额度恢复。';}
    }
    batch.events.push({at:now(),message:op.kind==='account'?'已保存免费余额核查。':op.kind==='page'?'已采集并保存新人物资料。':op.kind==='finder'?'已保存一位人物的邮箱查询结果。':'已保存邮箱验证回执。'});
  }catch(e){
    const error=e as any;op.state=error.known||Number.isInteger(error.status)?'failed':'unknown';op.reason=String(error.message||'来源结果未知').slice(0,200);op.finishedAt=now();batch.failures++;
    if(op.state==='unknown'||/401|403|429|5\d\d|QUOTA|RATE_LIMIT/.test(op.reason))(batch.disabledProviders||={})[op.provider]=op.reason;
    if(op.kind==='account'&&op.slot==='before'){if(batch.mode==='people_enrichment')(batch.accounts||={})[op.provider]={plan:'unknown',remaining:0};else{batch.state='blocked';batch.reason='无法确认现有免费余额，已停止，未调用人物来源。';}}else await apply(op);
  }
  if(batch.pauseRequested){batch.resumeState=batch.state;batch.state='paused';}await save();
}
