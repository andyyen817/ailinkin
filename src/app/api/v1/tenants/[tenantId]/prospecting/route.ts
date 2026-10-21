import {withTenant} from '@/server/tenant';
import {json,failure,mutationOrigin} from '@/server/http';
import {AccessError} from '@/server/policy';
import {createOperatorDirection,listOperatorDirections} from '@/server/operator-direction-store';
export const runtime='nodejs';
type Context={params:Promise<{tenantId:string}>};
export async function GET(request:Request,{params}:Context){try{
  const {tenantId}=await params;
  return json(await withTenant(request,tenantId,async(tx,ctx)=>({directions:await listOperatorDirections(tx),owner:ctx.role==='owner'})));
}catch(e){return failure(e);}}
export async function POST(request:Request,{params}:Context){try{
  mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();
  if(!reader)throw new AccessError('INVALID_INPUT',400);
  let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>8192){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(p.value);}}finally{reader.releaseLock();}
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return json(await withTenant(request,tenantId,(tx,ctx)=>createOperatorDirection(tx,tenantId,ctx.userId,input),true),201);
}catch(e){return failure(e);}}
