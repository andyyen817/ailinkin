import {withTenant} from '@/server/tenant';
import {json,failure,mutationOrigin} from '@/server/http';
import {AccessError} from '@/server/policy';
import {pageOperatorInput,pageOperatorAction} from '@/server/operator-selfservice-service';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{tenantId:string}>}){try{
  mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
  let size=0;const chunks:Uint8Array[]=[];try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>65536){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(p.value);}}finally{reader.releaseLock();}
  const input=pageOperatorInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if(input.action!=='authorize_enrichment'||!('method' in input.grant)||input.grant.method!=='trace_v2')throw new AccessError('INVALID_INPUT',400);
  return json(await withTenant(request,tenantId,(tx,ctx)=>pageOperatorAction(tx,tenantId,ctx.userId,input),true));
}catch(e){return failure(e);}}
