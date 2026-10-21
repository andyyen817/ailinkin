import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {directionData,directionInput} from './operator-selfservice-policy';
import {AccessError} from './policy';
export function publicDirection(row:any){
  return {id:row.id,version:row.version,state:row.state,direction:row.data.operatorDirection,
    companies:row.data.companies.map((c:any)=>({id:c.id,name:c.name,website:c.website,country:c.country,status:c.status})),
    batches:(row.data.operatorBatches||[]).map((b:any)=>({id:b.id,state:b.state,failures:b.failures||0,createdAt:b.createdAt}))};
}
export async function listOperatorDirections(tx:any){
  const rows=await tx.$queryRaw`SELECT id,tenant_id,version,state,data FROM research_campaign WHERE data ? 'operatorDirection' ORDER BY created_at DESC LIMIT 100`;
  return rows.map(publicDirection);
}
export async function createOperatorDirection(tx:any,tenantId:string,actorId:string,raw:unknown){
  const input=directionInput.parse(raw),data=directionData(input,tenantId);
  const fingerprint=createHash('sha256').update(JSON.stringify(['operator-direction-v1',tenantId,{...input,name:undefined}])).digest('hex');
  await tx.$executeRaw`INSERT INTO research_campaign(id,tenant_id,actor_id,input_hash,data) VALUES(${randomUUID()},${tenantId},${actorId},${fingerprint},${JSON.stringify(data)}::jsonb) ON CONFLICT(tenant_id,input_hash) DO NOTHING`;
  const rows=await tx.$queryRaw`SELECT id,tenant_id,version,state,data FROM research_campaign WHERE tenant_id=${tenantId} AND input_hash=${fingerprint}`;
  if(!rows.length||rows[0].tenant_id!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);
  return publicDirection(rows[0]);
}
