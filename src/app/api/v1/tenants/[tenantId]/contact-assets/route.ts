import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {campaign} from '@/server/research-store';
import {json,failure,mutationOrigin} from '@/server/http';
import {AccessError} from '@/server/policy';
import {contactAssetCsv,saveContactCandidates} from '@/server/contact-assets-service';
export const runtime='nodejs';
type Context={params:Promise<{tenantId:string}>};
export async function GET(request:Request,{params}:Context){
  try{const {tenantId}=await params,id=z.uuid().parse(new URL(request.url).searchParams.get('campaignId'));
    const csv=await withTenant(request,tenantId,async tx=>{const row=await campaign(tx,id);if(row.tenant_id!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);return contactAssetCsv(row);});
    return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="contact-research.csv"','Cache-Control':'private, no-store'}});
  }catch(e){return failure(e);}
}
export async function POST(request:Request,{params}:Context){
  try{
    mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
    let size=0;const chunks:Uint8Array[]=[];try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>8192){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(p.value);}}finally{reader.releaseLock();}
    const input=z.object({action:z.literal('save_candidates'),campaignId:z.uuid(),runId:z.string().regex(/^CE-[a-f0-9]{24}$/)}).strict().parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return json(await withTenant(request,tenantId,async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':contact-assets:'+input.campaignId}))`;
      return saveContactCandidates(tx,await campaign(tx,input.campaignId),tenantId,input.runId);},true));
  }catch(e){return failure(e);}
}
