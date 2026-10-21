import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {json,failure,mutationOrigin} from '@/server/http';
import {campaign} from '@/server/research-store';
import {prepareContactPackages} from '@/server/contact-package';
export const runtime='nodejs';
type Context={params:Promise<{tenantId:string}>};
const input=z.object({action:z.literal('prepare'),campaignId:z.uuid(),companyIds:z.array(z.string().regex(/^C-[a-f0-9-]{36}$/)).min(1).max(3)}).strict();
export async function GET(request:Request,context:Context){
  try{
    const {tenantId}=await context.params,id=z.uuid().parse(new URL(request.url).searchParams.get('campaignId'));
    return json(await withTenant(request,tenantId,async tx=>{
      const row=await campaign(tx,id);return {packages:row.data.companies.filter((c:any)=>c.contactPackage).map((c:any)=>c.contactPackage)};
    }));
  }catch(e){return failure(e);}
}
export async function POST(request:Request,context:Context){
  try{
    mutationOrigin(request);const {tenantId}=await context.params,text=await request.text();
    if(text.length>4000)return json({error:'INPUT_TOO_LARGE'},413);
    const raw=input.parse(JSON.parse(text));
    return json(await withTenant(request,tenantId,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':contact-package:'+raw.campaignId}))`;
      const row=await campaign(tx,raw.campaignId),before=JSON.stringify(row.data);
      const packages=prepareContactPackages(row,raw.companyIds),data=JSON.stringify(row.data);
      if(before!==data){
        const count=await tx.$executeRaw`UPDATE research_campaign SET data=${data}::jsonb,version=version+1,updated_at=now() WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version} AND state<>'running'`;
        if(count!==1)throw Error('SEARCH_VERSION_CONFLICT');
      }
      return {packages,externalRequests:0,sent:0};
    },true));
  }catch(e){return failure(e);}
}
