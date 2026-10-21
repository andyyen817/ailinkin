import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {campaign} from '@/server/research-store';
import {readContactImage} from '@/server/contact-evidence-store';
import {AccessError} from '@/server/policy';
import {failure} from '@/server/http';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{tenantId:string}>}){
  try{
    const {tenantId}=await params,u=new URL(request.url),campaignId=z.uuid().parse(u.searchParams.get('campaignId')),
      imageId=z.string().regex(/^[a-f0-9]{64}$/).parse(u.searchParams.get('imageId'));
    await withTenant(request,tenantId,async tx=>{
      const row=await campaign(tx,campaignId);
      if(row.tenant_id!==tenantId||!(row.data.contactResearchRuns||[]).some((r:any)=>(r.images||[]).some((i:any)=>i.imageId===imageId)))throw new AccessError('EVIDENCE_NOT_FOUND',404);
    });
    const bytes=await readContactImage(tenantId,imageId);
    return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(e){return failure(e);}
}
