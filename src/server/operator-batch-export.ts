import 'server-only';
import {readOperatorExport,writeOperatorExport} from './operator-export-store';
import {contactExcelView} from './contact-excel-view';
import {combineContactExcel} from './contact-excel-bundle';
import {contactReviewXlsx} from './contact-review-xlsx';
import {completeSavedContactBatch} from './contact-batch-completion';
import {contactReviewTable} from './contact-review-table';
import {AccessError} from './policy';
export async function buildOperatorExport(rows:any[],scope:any,batch:any){
  const views=scope.targets.map((t:any)=>{
    const row=rows.find(r=>r.id===t.campaignId);if(!row||row.tenant_id!==scope.tenantId)throw Error('OPERATOR_EXPORT_TENANT_DENIED');
    const result=completeSavedContactBatch(row,batch.actorId,contactReviewTable(row),[t.companyId]);
    if(result.changed)row.data.contactBatchCompletions.at(-1).operatorBatchId=batch.id;
    return contactExcelView(row,t.companyId);
  });
  if(scope.selfService&&!views.length){const anchor=rows.find(r=>r.id===scope.anchorCampaignId);if(!anchor)throw Error('OPERATOR_EXPORT_TENANT_DENIED');views.push(contactExcelView(anchor));}
  const model=combineContactExcel(views);
  if(scope.selfService)model.market=scope.direction.name;
  if(batch.export)await readOperatorExport(scope.tenantId,batch.id,batch.export);
  const bytes=await contactReviewXlsx(model);
  const stored=await writeOperatorExport(scope.tenantId,batch.id,bytes);
  return {...stored,bytes:bytes.length,createdAt:new Date().toISOString(),personRows:model.personRows,summary:model.contactSummary};
}
export async function downloadOperatorExport(rows:any[],scope:any,batchId:string){
  const row=rows.find(r=>r.id===scope.anchorCampaignId),batch=row?.data.operatorBatches?.find((b:any)=>b.id===batchId);
  if(!batch?.export||batch.state!=='done')throw new AccessError('OPERATOR_EXPORT_NOT_READY',409);
  const bytes=await readOperatorExport(scope.tenantId,batchId,batch.export);
  const name=scope.selfService?String(scope.direction.name).replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,80)+'_个人联系方式总表.xlsx':'三家企业_个人联系方式总表.xlsx';
  return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name),'Cache-Control':'private, no-store'}});
}
