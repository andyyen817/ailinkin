import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {campaign} from '@/server/research-store';
import {json,failure,mutationOrigin} from '@/server/http';
import {AccessError} from '@/server/policy';
import {enterpriseSelectionView,applyEnterpriseSelection,enterpriseCsv} from '@/server/enterprise-selection';
import {persistContactReview} from '@/server/contact-review-service';
export const runtime='nodejs';type Context={params:Promise<{tenantId:string}>};
function check(row:any,tenantId:string){if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);}
export async function GET(request:Request,{params}:Context){
  try{const {tenantId}=await params,url=new URL(request.url),id=z.uuid().parse(url.searchParams.get('campaignId'));
    const result=await withTenant(request,tenantId,async tx=>{const row=await campaign(tx,id);check(row,tenantId);return url.searchParams.get('export')==='csv'?enterpriseCsv(row):enterpriseSelectionView(row);});
    return typeof result==='string'?new Response(result,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="enterprise-shortlist.csv"','Cache-Control':'private, no-store'}}):json(result);
  }catch(e){return failure(e);}
}
export async function POST(request:Request,{params}:Context){
  try{mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
    let size=0;const chunks:Uint8Array[]=[];try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>524288){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(p.value);}}finally{reader.releaseLock();}
    const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return json(await withTenant(request,tenantId,async(tx,context)=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':enterprise-selection'}))`;
      const id=z.uuid().parse(input.campaignId),row=await campaign(tx,id),result=applyEnterpriseSelection(row,tenantId,context.userId,input);
      if(result.changed)await persistContactReview(tx,row,tenantId);return {...result,reused:!result.changed};
    },true));
  }catch(e){return failure(e);}
}
