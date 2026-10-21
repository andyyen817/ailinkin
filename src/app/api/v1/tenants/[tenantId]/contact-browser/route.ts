import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {campaign} from '@/server/research-store';
import {json,failure,mutationOrigin} from '@/server/http';
import {readBrowserScope,browserJobsView,runBrowserContact,browserHistory} from '@/server/browser-contact-service';
export const runtime='nodejs';export const maxDuration=180;
type Context={params:Promise<{tenantId:string}>};
export async function GET(request:Request,{params}:Context){try{
  const {tenantId}=await params,id=z.uuid().parse(new URL(request.url).searchParams.get('campaignId')),scope=await readBrowserScope();
  return json(await withTenant(request,tenantId,async(tx,ctx)=>browserJobsView((await browserHistory(tx,await campaign(tx,id),scope)).shared,ctx.userId,scope)));
}catch(e){return failure(e);}}
export async function POST(request:Request,{params}:Context){try{
  mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();if(!reader)throw Error('INVALID_INPUT');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>16384){await reader.cancel();return json({error:'INPUT_TOO_LARGE'},413);}chunks.push(item.value);}}finally{reader.releaseLock();}
  return json(await runBrowserContact(request,tenantId,JSON.parse(Buffer.concat(chunks).toString('utf8'))));
}catch(e){return failure(e);}}
