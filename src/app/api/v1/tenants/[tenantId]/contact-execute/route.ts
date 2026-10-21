import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {campaign} from '@/server/research-store';
import {json,failure,mutationOrigin} from '@/server/http';
import {AccessError} from '@/server/policy';
import {contactExecutionStatus,contactExecuteInput,runContactExecution} from '@/server/contact-execution-service';
export const runtime='nodejs';
type Context={params:Promise<{tenantId:string}>};
export async function GET(request:Request,{params}:Context){
  try{const {tenantId}=await params,id=z.uuid().parse(new URL(request.url).searchParams.get('campaignId'));
    return json(await withTenant(request,tenantId,async tx=>{
      const row=await campaign(tx,id);if(row.tenant_id!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);return contactExecutionStatus(row,tenantId);
    }));
  }catch(e){return failure(e);}
}
export async function POST(request:Request,{params}:Context){
  try{
    mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
    let size=0;const chunks:Uint8Array[]=[];
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8192){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(part.value);}}
    finally{reader.releaseLock();}
    const input=contactExecuteInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    await withTenant(request,tenantId,async tx=>{await campaign(tx,input.campaignId);},true);
    return json(await runContactExecution(request,tenantId,input));
  }catch(e){return failure(e);}
}
