import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {json,failure,mutationOrigin} from '@/server/http';
import {AccessError} from '@/server/policy';
import {viewOperatorCrm,saveOperatorCrm} from '@/server/operator-crm-service';
export const runtime='nodejs';
type Context={params:Promise<{tenantId:string}>};
export async function GET(request:Request,{params}:Context){
  try{
    const {tenantId}=await params,url=new URL(request.url);
    const campaignId=z.uuid().parse(url.searchParams.get('campaignId'));
    const batchId=z.uuid().parse(url.searchParams.get('batchId'));
    return json(await withTenant(request,tenantId,tx=>viewOperatorCrm(tx,tenantId,campaignId,batchId)));
  }catch(error){return failure(error);}
}
export async function POST(request:Request,{params}:Context){
  try{
    mutationOrigin(request);
    const {tenantId}=await params,reader=request.body?.getReader();
    if(!reader)throw new AccessError('INVALID_INPUT',400);
    const chunks:Uint8Array[]=[];let size=0;
    try{
      while(true){
        const chunk=await reader.read();if(chunk.done)break;
        size+=chunk.value.length;
        if(size>32768){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}
        chunks.push(chunk.value);
      }
    }finally{reader.releaseLock();}
    const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return json(await withTenant(request,tenantId,
      (tx,actor)=>saveOperatorCrm(tx,tenantId,actor.userId,input),true,30000));
  }catch(error){return failure(error);}
}
