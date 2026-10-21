import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {json,failure,mutationOrigin} from '@/server/http';
import {AccessError} from '@/server/policy';
import {campaign} from '@/server/research-store';
import {prepareContactResearch,savedContactResearch} from '@/server/contact-research-service';
import {contactResearchInput} from '@/domain/contact-research';
export const runtime='nodejs';
type Context={params:Promise<{tenantId:string}>};
async function inputFor(request:Request){
  const reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;
    if(size>8192){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(part.value);}
  }finally{reader.releaseLock();}
  return contactResearchInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
export async function GET(request:Request,context:Context){
  try{const {tenantId}=await context.params,id=z.uuid().parse(new URL(request.url).searchParams.get('campaignId'));
    return json(await withTenant(request,tenantId,async tx=>savedContactResearch(await campaign(tx,id))));
  }catch(e){return failure(e);}
}
export async function POST(request:Request,context:Context){
  try{
    mutationOrigin(request);const {tenantId}=await context.params,input=await inputFor(request);
    return json(await withTenant(request,tenantId,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':contact-research:'+input.campaignId}))`;
      const row=await campaign(tx,input.campaignId),before=JSON.stringify(row.data),result=prepareContactResearch(row,tenantId,input);
      if(before!==JSON.stringify(row.data)){
        const changed=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,version=version+1,updated_at=now()
          WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version} AND state<>'running'`;
        if(changed!==1)throw new AccessError('SEARCH_VERSION_CONFLICT',409);
      }
      return result;
    },true));
  }catch(e){return failure(e);}
}
