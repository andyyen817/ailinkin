import 'server-only';
import {discoveryRequest} from './operator-discovery-provider';
export function operatorRequestIdentity(op:any,batch:any){
  if(op.kind==='account')return null;
  if(op.kind==='public_search')return JSON.stringify(['public_search',op.query]);
  if(op.kind==='public_page')return JSON.stringify(['public_page',op.url]);
  if(['location','company_search'].includes(op.kind))return JSON.stringify(discoveryRequest(op,batch));
  if(op.kind==='page')return JSON.stringify(['page',op.domain,op.page]);
  if(op.kind==='verify')return JSON.stringify(['verify',op.provider,op.email.toLowerCase()]);
  const person=batch.people.find((p:any)=>p.personKey===op.personKey);
  if(op.kind==='finder'&&person)return JSON.stringify(['finder',op.provider,person.sourcePersonId||person.profileUrl]);
  return null;
}
export async function reuseOperatorOperation(op:any,batch:any,rows:any[],apply:any){
  if(!batch.selfService)return false;
  const identity=operatorRequestIdentity(op,batch);if(!identity)return false;
  for(const row of rows)for(const previous of row.data.operatorBatches||[]){
    for(const receipt of previous.receipts||[]){
      if(receipt.state==='skipped'||operatorRequestIdentity(receipt,previous)!==identity)continue;
      const done=receipt.state==='done';
      Object.assign(op,{state:done?'done':'skipped',reusedFrom:{campaignId:row.id,batchId:previous.id,receiptId:receipt.id,state:receipt.state},
        stages:[{stage:'reused_saved_receipt',at:new Date().toISOString()}],finishedAt:new Date().toISOString(),
        ...(done?{result:structuredClone(receipt.result)}:{reason:'既有相同请求失败或结果未知，禁止自动重发。'})});
      batch.receipts.push(op);await apply(op);batch.events.push({at:new Date().toISOString(),message:done?'已复用历史查询回执，没有新增来源请求。':'已阻止重复提交历史失败或未知请求。'});
      return true;
    }
  }
  return false;
}
