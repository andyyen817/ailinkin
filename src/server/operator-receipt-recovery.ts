import 'server-only';
import {normalizeFinder} from './contact-provider-finders';
import {applyOperatorOperation} from './operator-batch-provider';
export function reconcileOperatorReceipts(batch:any,rows:any[]){
  let recovered=0;
  for(const op of batch.receipts||[]){
    if(op.kind!=='finder'||op.provider!=='prospeo'||op.state!=='unknown'||!op.reason?.includes('expired transaction'))continue;
    const stage=op.stages.findLast((s:any)=>s.stage==='body_received'&&s.rawResponse);
    if(!stage||![200,400].includes(stage.httpStatus))continue;
    let raw:any;try{raw=JSON.parse(stage.rawResponse);}catch{continue;}
    if(!(stage.httpStatus===400&&raw.error===true&&raw.error_code==='NO_MATCH'||stage.httpStatus===200&&raw.error===false&&raw.person))continue;
    const person=batch.people.find((p:any)=>p.personKey===op.personKey);if(!person)continue;
    (op.recoveryHistory||=[]).push({at:new Date().toISOString(),previousState:op.state,reason:op.reason,method:'saved_body_no_network'});
    op.result=normalizeFinder('prospeo',person,{...raw,httpStatus:stage.httpStatus},op.finishedAt);op.state='done';op.reconciledAt=new Date().toISOString();
    applyOperatorOperation(batch,rows,op);recovered++;
    const left=Number(stage.rateHeaders?.['x-daily-request-left']);if(Number.isInteger(left)&&left>=0)batch.currentDailyRemaining=left;
    if(batch.disabledProviders?.prospeo===op.reason&&!batch.receipts.some((r:any)=>r.provider==='prospeo'&&['failed','unknown','reserved'].includes(r.state)))delete batch.disabledProviders.prospeo;
    batch.events.push({at:new Date().toISOString(),message:'已用完整来源回执恢复一次保存超时；原失败计数保留，没有重新查询。'});
  }
  return recovered;
}
