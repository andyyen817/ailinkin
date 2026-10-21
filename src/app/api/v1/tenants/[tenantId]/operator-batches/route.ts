import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {json,failure,mutationOrigin} from '@/server/http';
import {AccessError} from '@/server/policy';
import {pageOperatorContext,pageOperatorView,pageOperatorInput,pageOperatorAction} from '@/server/operator-selfservice-service';
import {downloadOperatorExport} from '@/server/operator-batch-export';
export const runtime='nodejs';type Context={params:Promise<{tenantId:string}>};
export async function GET(request:Request,{params}:Context){try{
  const {tenantId}=await params,url=new URL(request.url),id=z.uuid().parse(url.searchParams.get('campaignId'));
  return await withTenant(request,tenantId,async tx=>{
    const download=url.searchParams.has('download')?z.uuid().parse(url.searchParams.get('download')):undefined;
    const context=await pageOperatorContext(tx,tenantId,id,download,true);
    if(download)return downloadOperatorExport(context.rows,context.scope,download);
    return json(pageOperatorView(context));
  });
}catch(e){return failure(e);}}
export async function POST(request:Request,{params}:Context){try{
  mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
  let size=0;const chunks:Uint8Array[]=[];try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>4096){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(p.value);}}finally{reader.releaseLock();}
  const input=pageOperatorInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  return json(await withTenant(request,tenantId,(tx,ctx)=>pageOperatorAction(tx,tenantId,ctx.userId,input),true,input.action==='refresh_export'?30000:5000));
}catch(e){return failure(e);}}
