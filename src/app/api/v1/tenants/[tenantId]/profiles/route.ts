import {withTenant} from '@/server/tenant';
import {json,failure,mutationOrigin} from '@/server/http';
import {profileInput,readProfiles,readRevisions,saveProfile} from '@/server/profiles';
import {AccessError} from '@/server/policy';
type Route={params:Promise<{tenantId:string}>};
export async function GET(request:Request,route:Route){
 try{const {tenantId}=await route.params;const url=new URL(request.url);
  if(url.searchParams.has('history'))return json(await withTenant(request,tenantId,tx=>readRevisions(tx,url.searchParams.get('kind')??'',url.searchParams.get('history')??'')));
  return json(await withTenant(request,tenantId,readProfiles));
 }catch(error){return failure(error);}
}
export async function POST(request:Request,route:Route){
 try{mutationOrigin(request);const {tenantId}=await route.params;
  const reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const result=await reader.read();if(result.done)break;size+=result.value.length;if(size>131072){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(result.value);}}finally{reader.releaseLock();}
  const bytes=Buffer.concat(chunks);const input=profileInput.parse(JSON.parse(bytes.toString('utf8')));
  const saved=await withTenant(request,tenantId,tx=>saveProfile(tx,tenantId,input),input.kind!=='icp');
  return json({record:saved},input.expectedVersion===0?201:200);
 }catch(error){return failure(error);}
}
