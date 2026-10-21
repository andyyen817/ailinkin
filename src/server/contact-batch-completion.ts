import 'server-only';
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
import type {Campaign} from '@/domain/research';import type {ReviewTable} from '@/domain/contact-review';
import {AccessError} from './policy';import {contactBatchOutcome} from './contact-batch-outcome';import {contactExportBundle} from './contact-excel-bundle';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function basis(table:ReviewTable,companyIds:string[],outcome:ReturnType<typeof contactBatchOutcome>){return hash([table.tableHash,companyIds,outcome.counts,outcome.people.map(p=>[p.rowId,p.code,p.reason,p.nextAction,p.duplicateNotice])]);}
export function savedContactBatchView(row:Campaign,table:ReviewTable){
  const outcome=contactBatchOutcome(table.rows);
  const completions=(row.data.contactBatchCompletions||[]).map((c:any)=>{
    const selected=contactBatchOutcome(table.rows.filter(p=>c.companyIds.includes(p.companyId)));
    return {...c,stale:c.basisHash!==basis(table,c.companyIds,selected)};
  });
  const companies=Object.fromEntries([...new Set(table.rows.map(r=>r.companyId))].map(id=>[id,contactBatchOutcome(table.rows.filter(r=>r.companyId===id))]));
  return {...outcome,companies,completions};
}
export function completeSavedContactBatch(row:Campaign,actorId:string,table:ReviewTable,selected?:string[],now=new Date().toISOString()){
  const companyIds=[...new Set(selected||table.rows.map(r=>r.companyId))].sort();
  if(!companyIds.length||companyIds.some(id=>!row.data.companies.some((c:any)=>c.id===id)))throw new AccessError('CONTACT_BATCH_COMPANY_NOT_FOUND',400);
  const outcome=contactBatchOutcome(table.rows.filter(r=>companyIds.includes(r.companyId))),basisHash=basis(table,companyIds,outcome);
  if(!outcome.people.length)throw new AccessError('CONTACT_BATCH_NO_PEOPLE',409);
  const history=row.data.contactBatchCompletions||=[];
  if(history.some((c:any)=>c.basisHash===basisHash))return {changed:false};
  if(history.length>=100)throw new AccessError('CONTACT_BATCH_COMPLETION_HISTORY_LIMIT',409);
  history.push({id:'CBC-'+basisHash.slice(0,24),basisHash,tableHash:table.tableHash,companyIds,actorId,completedAt:now,
    state:'completed_with_gaps',counts:outcome.counts,people:outcome.people.map(p=>({rowId:p.rowId,personId:p.personId,status:p.status,reason:p.reason,nextAction:p.nextAction,duplicateNotice:p.duplicateNotice})),
    mode:'saved_receipts',externalRequests:0,providerCredits:0,sent:0,notice:'本批已保存并逐人整理。未找到和归属待核记录保留；没有重新查询供应商。'});
  return {changed:true};
}
// Export grouping is read-only metadata. An expired collection scope never enables collection here.
export async function savedContactExportBundle(row:Campaign){
  try{const scope=JSON.parse(await fs.readFile(/* turbopackIgnore: true */ process.env.PERSON_RESEARCH_SCOPE_PATH||'.runtime/person-research-scope.json','utf8'));return contactExportBundle(scope,row);}catch{return null;}
}
