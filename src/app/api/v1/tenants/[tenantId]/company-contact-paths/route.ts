import {z} from 'zod';
import {withTenant} from '@/server/tenant';import {campaign} from '@/server/research-store';
import {json,failure,mutationOrigin} from '@/server/http';
import {readCompanyPathScope,companyPathRows,companyPaths} from '@/server/company-path-service';
import {companyPathView} from '@/server/company-path-policy';
export const runtime='nodejs';export const maxDuration=180;
type Context={params:Promise<{tenantId:string}>};
export async function GET(request:Request,{params}:Context){try{
  const {tenantId}=await params,id=z.uuid().parse(new URL(request.url).searchParams.get('campaignId')),scope=await readCompanyPathScope();
  return json(await withTenant(request,tenantId,async tx=>{const row=await campaign(tx,id);return companyPathView(row,await companyPathRows(tx,row,scope),scope);}));
}catch(e){return failure(e);}}
export async function POST(request:Request,{params}:Context){try{
  mutationOrigin(request);if(Number(request.headers.get('content-length'))>4096)return json({error:'INPUT_TOO_LARGE'},413);
  const text=await request.text();if(text.length>4096)return json({error:'INPUT_TOO_LARGE'},413);
  return json(await companyPaths(request,(await params).tenantId,JSON.parse(text)));
}catch(e){return failure(e);}}
