import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {campaign} from '@/server/research-store';
import {json,failure,mutationOrigin} from '@/server/http';
import {contactBatchInput} from '@/domain/contact-batch';
import {readBatchScope,batchExecutionStatus,prepareContactBatch,runContactBatch} from '@/server/contact-batch-service';
import {persistContactReview} from '@/server/contact-review-service';
export const runtime='nodejs';export const maxDuration=180;type Context={params:Promise<{tenantId:string}>};
export async function GET(request:Request,{params}:Context){
  try{const {tenantId}=await params,id=z.uuid().parse(new URL(request.url).searchParams.get('campaignId')),scope=await readBatchScope(id);
    return json(await withTenant(request,tenantId,async tx=>{const row=await campaign(tx,id);return {batches:(row.data.contactBatches||[]).map((b:any)=>({...b,execution:batchExecutionStatus(row,b,scope)})),sent:0};}));
  }catch(e){return failure(e);}
}
export async function POST(request:Request,{params}:Context){
  try{mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();if(!reader)throw Error('INVALID_INPUT');
    let size=0;const chunks:Uint8Array[]=[];try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>16384){await reader.cancel();return json({error:'INPUT_TOO_LARGE'},413);}chunks.push(p.value);}}finally{reader.releaseLock();}
    const input=contactBatchInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if(input.action==='prepare')return json(await withTenant(request,tenantId,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':contact-batch:'+input.campaignId}))`;const row=await campaign(tx,input.campaignId),result=prepareContactBatch(row,tenantId,input);
      if(!result.reused)await persistContactReview(tx,row,tenantId);return {...result,sent:0};
    },true));
    return json(await runContactBatch(request,tenantId,input));
  }catch(e){return failure(e);}
}
