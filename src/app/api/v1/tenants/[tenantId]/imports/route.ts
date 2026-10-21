import {createHash} from 'node:crypto';
import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {json,failure,mutationOrigin} from '@/server/http';
import {AccessError} from '@/server/policy';
import {parseContactCsv,mapContactCsv,MAX_CSV_BYTES} from '@/domain/contact-csv';
type Route={params:Promise<{tenantId:string}>};
export async function GET(request:Request,route:Route){try{const {tenantId}=await route.params;return json(await withTenant(request,tenantId,tx=>tx.$queryRaw`SELECT id,state,report,created_at,expires_at FROM contact_import ORDER BY created_at DESC LIMIT 20`));}catch(e){return failure(e);}}
export async function POST(request:Request,route:Route){
 try{
  mutationOrigin(request);const {tenantId}=await route.params;
  await withTenant(request,tenantId,async()=>true);
  const reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>MAX_CSV_BYTES){await reader.cancel();throw new AccessError('CSV_TOO_LARGE',413);}chunks.push(next.value);}}finally{reader.releaseLock();}
  let table;try{table=parseContactCsv(Buffer.concat(chunks));}catch{throw new AccessError('CSV_INVALID_OR_LIMIT_EXCEEDED',400);}
  const url=new URL(request.url);
  if(!url.searchParams.has('confirm'))return json({headers:table.headers,preview:table.rows.slice(0,10),rows:table.rows.length});
  const key=z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/).parse(request.headers.get('Idempotency-Key'));
  const mode=z.enum(['skip','fill_empty']).parse(url.searchParams.get('mode'));
  let rows;try{rows=mapContactCsv(table,JSON.parse(url.searchParams.get('mapping')??'{}'));}catch{throw new AccessError('CSV_MAPPING_INVALID',400);}
  const payload=JSON.stringify(rows);const hash=createHash('sha256').update(mode).update(payload).digest('hex');
  const ids=await withTenant(request,tenantId,tx=>tx.$queryRaw<Array<{id:string}>>`SELECT queue_contact_import(${key},${hash},${mode},${payload}::jsonb) AS id`);
  return json({jobId:ids[0].id},202);
 }catch(e){return failure(e);}
}
