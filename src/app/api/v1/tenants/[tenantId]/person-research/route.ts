import {z} from 'zod';
import {withTenant} from '@/server/tenant';import {campaign} from '@/server/research-store';import {persistContactReview} from '@/server/contact-review-service';
import {json,failure,mutationOrigin} from '@/server/http';import {AccessError} from '@/server/policy';
import {applyPersonResearch,personResearchView,readPersonScope} from '@/server/person-research-service';import {personResearchInput} from '@/domain/person-research';
export const runtime='nodejs';type Context={params:Promise<{tenantId:string}>};
export async function GET(request:Request,{params}:Context){try{
  const {tenantId}=await params,id=z.uuid().parse(new URL(request.url).searchParams.get('campaignId')),scope=await readPersonScope();
  return json(await withTenant(request,tenantId,async tx=>{const row=await campaign(tx,id);if(row.tenant_id!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);return personResearchView(row,scope);}));
}catch(e){return failure(e);}}
export async function POST(request:Request,{params}:Context){try{
  mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
  let size=0;const chunks:Uint8Array[]=[];try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>32768){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(p.value);}}finally{reader.releaseLock();}
  const input=personResearchInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))),scope=await readPersonScope();
  return json(await withTenant(request,tenantId,async(tx,context)=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':person-research:'+input.campaignId}))`;
    const row=await campaign(tx,input.campaignId),result=applyPersonResearch(row,tenantId,context.userId,input,scope);
    if(result.changed)await persistContactReview(tx,row,tenantId);return {...personResearchView(row,scope),reused:!result.changed};
  },true));
}catch(e){return failure(e);}}
