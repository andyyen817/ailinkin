import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {json,failure,mutationOrigin} from '@/server/http';
import {readContacts,saveContact,saveList,assignList} from '@/server/contacts';
import {AccessError} from '@/server/policy';
type Route={params:Promise<{tenantId:string}>};
export async function GET(request:Request,route:Route){
 try{const {tenantId}=await route.params;const url=new URL(request.url);
  const offset=z.coerce.number().int().min(0).max(1000000).parse(url.searchParams.get('offset')??0);
  const id=url.searchParams.has('id')?z.uuid().parse(url.searchParams.get('id')):undefined;
  return json(await withTenant(request,tenantId,tx=>readContacts(tx,{q:url.searchParams.get('q')??'',stage:url.searchParams.get('stage')??'',listId:url.searchParams.get('listId')??'',offset,id})));
 }catch(e){return failure(e);}
}
export async function POST(request:Request,route:Route){
 try{mutationOrigin(request);const {tenantId}=await route.params;
  const reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>65536){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(next.value);}}finally{reader.releaseLock();}
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(input.kind==='list'){
   const value=z.object({kind:z.literal('list'),name:z.string()}).strict().parse(input);
   return json(await withTenant(request,tenantId,tx=>saveList(tx,tenantId,value.name)),201);
  }
  if(input.kind==='list_member'){
   const value=z.object({kind:z.literal('list_member'),listId:z.uuid(),contactId:z.uuid(),remove:z.boolean().default(false)}).strict().parse(input);
   await withTenant(request,tenantId,tx=>assignList(tx,tenantId,value.listId,value.contactId,value.remove));return json({saved:true});
  }
  return json({record:await withTenant(request,tenantId,tx=>saveContact(tx,tenantId,input))},input.expectedVersion===0?201:200);
 }catch(e){return failure(e);}
}
