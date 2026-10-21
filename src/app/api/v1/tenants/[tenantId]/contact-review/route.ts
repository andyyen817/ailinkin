import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {campaign} from '@/server/research-store';
import {json,failure,mutationOrigin} from '@/server/http';
import {AccessError} from '@/server/policy';
import {reviewInput} from '@/domain/contact-review';
import {reviewView,applyReview,persistContactReview} from '@/server/contact-review-service';
import {contactMailHandoff,prepareReviewedMail} from '@/server/contact-review-handoff';
import {contactReviewCsv} from '@/server/contact-review-export';
import {preciseContactQueries} from '@/server/contact-query-plan';
import {contactExcelFilter,prepareContactExcel,contactExcelResponse} from '@/server/contact-excel-request';
import {contactBundleInput,contactExportBundle,combineContactExcel} from '@/server/contact-excel-bundle';
import {savedContactExportBundle} from '@/server/contact-batch-completion';
export const runtime='nodejs';
type Context={params:Promise<{tenantId:string}>};
function check(row:any,tenantId:string){if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);}
export async function GET(request:Request,{params}:Context){
  try{const {tenantId}=await params,url=new URL(request.url),id=z.uuid().parse(url.searchParams.get('campaignId'));
    if(url.searchParams.get('export')==='xlsx'){
      const companyId=contactExcelFilter(url);
      const group=url.searchParams.get('bundle'),bundle=group?contactBundleInput.parse(JSON.parse(group)):null;
      const view=await withTenant(request,tenantId,async tx=>{const row=await campaign(tx,id);check(row,tenantId);
        if(!bundle)return prepareContactExcel(row,companyId);
        const views=[];const seen=new Set<string>();for(const item of bundle){const target=item.campaignId===id?row:await campaign(tx,item.campaignId);check(target,tenantId);
          for(const cid of item.companyIds){const key=item.campaignId+':'+cid;if(seen.has(key))continue;seen.add(key);views.push(prepareContactExcel(target,cid));}}
        return combineContactExcel(views);});
      return await contactExcelResponse(view);
    }
    const result=await withTenant(request,tenantId,async tx=>{const row=await campaign(tx,id);check(row,tenantId);
      return url.searchParams.get('export')==='csv'?contactReviewCsv(row):{view:reviewView(row),handoff:contactMailHandoff(row),queryPlan:preciseContactQueries(row),exportBundle:await savedContactExportBundle(row),externalRequests:0,sent:0};});
    return typeof result==='string'?new Response(result,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="contact-review.csv"','Cache-Control':'private, no-store'}}):json(result);
  }catch(e){return failure(e);}
}
export async function POST(request:Request,{params}:Context){
  try{
    mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
    let size=0;const chunks:Uint8Array[]=[];try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;
      if(size>524288){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
    const input=reviewInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return json(await withTenant(request,tenantId,async(tx,context)=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':contact-review:'+input.campaignId}))`;
      const row=await campaign(tx,input.campaignId),result=applyReview(row,tenantId,context.userId,input);
      const mail=input.action==='confirm_review'?prepareReviewedMail(row):null;
      if(result.changed||mail?.changed)await persistContactReview(tx,row,tenantId);
      return {view:reviewView(row),handoff:contactMailHandoff(row),queryPlan:preciseContactQueries(row),exportBundle:await savedContactExportBundle(row),reused:!result.changed&&!mail?.changed,externalRequests:0,sent:0};
    },true));
  }catch(e){return failure(e);}
}
