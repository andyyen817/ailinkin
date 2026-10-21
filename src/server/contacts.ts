import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Prisma} from '@/generated/prisma/client';
import {contactSchema,type ContactData} from '@/domain/contacts';
import {AccessError} from './policy';
type Row={id:string;tenant_id:string;data:ContactData;version:number};
export const contactInput=z.object({id:z.uuid().optional(),expectedVersion:z.number().int().min(0),data:contactSchema}).strict();
export async function readContacts(tx:Prisma.TransactionClient,query:{q?:string;stage?:string;listId?:string;offset?:number;id?:string}={}){
 const text=query.q??'';
 if(text.length>300)throw new AccessError('QUERY_TOO_LONG',400);
 const where=Prisma.sql`(${text}='' OR strpos(lower(c.data->>'name'),lower(${text}))>0 OR strpos(lower(c.data->>'company'),lower(${text}))>0 OR strpos(lower(c.data->>'email'),lower(${text}))>0)
 AND (${query.id??''}='' OR c.id=${query.id??''})
 AND (${query.stage??''}='' OR c.data->>'stage'=${query.stage??''})
 AND (${query.listId??''}='' OR EXISTS(SELECT 1 FROM list_member lm WHERE lm.contact_id=c.id AND lm.list_id=${query.listId??''}))`;
 const contacts=await tx.$queryRaw<Row[]>(Prisma.sql`SELECT c.* FROM contact c WHERE ${where} ORDER BY c.updated_at DESC,c.id LIMIT 25 OFFSET ${query.offset??0}`);
 const count=await tx.$queryRaw<Array<{count:bigint}>>(Prisma.sql`SELECT count(*) FROM contact c WHERE ${where}`);
 const lists=await tx.$queryRaw<Array<{id:string;name:string}>>`SELECT id,name FROM lead_list ORDER BY name`;
 const assignees=await tx.$queryRaw<Array<{id:string;name:string}>>`SELECT * FROM contact_assignees()`;
 return {contacts,total:Number(count[0].count),lists,assignees};
}
export async function saveContact(tx:Prisma.TransactionClient,tenantId:string,raw:unknown){
 const input=contactInput.parse(raw),data=JSON.stringify(input.data);
 if(input.expectedVersion===0){
  if(input.id)throw new AccessError('NEW_RECORD_ID_NOT_ALLOWED',400);
  const duplicates=await strongMatches(tx,input.data);
  if(duplicates.length)throw new AccessError('CONTACT_ALREADY_EXISTS',409);
  const rows=await tx.$queryRaw<Row[]>`INSERT INTO contact(id,tenant_id,data) VALUES(${randomUUID()},${tenantId},${data}::jsonb) RETURNING *`;
  const possibleDuplicates=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM contact WHERE id<>${rows[0].id} AND lower(data->>'name')=lower(${input.data.name}) AND lower(data->>'company')=lower(${input.data.company}) LIMIT 10`;
  return {...rows[0],possibleDuplicates};
 }
 if(!input.id)throw new AccessError('RECORD_ID_REQUIRED',400);
 const rows=await tx.$queryRaw<Row[]>`UPDATE contact SET data=${data}::jsonb WHERE id=${input.id} AND tenant_id=${tenantId} AND version=${input.expectedVersion} RETURNING *`;
 if(!rows.length)throw new AccessError('VERSION_CONFLICT_OR_UNAVAILABLE',409);
 return rows[0];
}
async function strongMatches(tx:Prisma.TransactionClient,data:ContactData){
 return tx.$queryRaw<Row[]>`SELECT * FROM contact WHERE (${data.email}<>'' AND email=${data.email}) OR (${data.linkedin}<>'' AND linkedin=${data.linkedin}) ORDER BY id FOR UPDATE`;
}
export async function importContact(tx:Prisma.TransactionClient,tenantId:string,data:ContactData,mode:'skip'|'fill_empty'){
 // Serialize imports within a tenant; the unique constraints also cover concurrent manual edits.
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId},0))`;
 const matches=await strongMatches(tx,data);
 if(matches.length>1)throw new AccessError('CONFLICTING_CONTACT_IDENTITIES',409);
 if(!matches.length)return {record:await saveContact(tx,tenantId,{expectedVersion:0,data}),outcome:'created'};
 const old=matches[0];const merged={...old.data};
 if(mode==='fill_empty')for(const key of ['title','country','email','linkedin','notes'] as const)if(!merged[key])merged[key]=data[key];
 merged.doNotContact=old.data.doNotContact||data.doNotContact;
 if(JSON.stringify(merged)===JSON.stringify(old.data))return {record:old,outcome:'skipped'};
 return {record:await saveContact(tx,tenantId,{id:old.id,expectedVersion:old.version,data:merged}),outcome:'updated'};
}
export async function saveList(tx:Prisma.TransactionClient,tenantId:string,name:string){
 const value=z.string().trim().min(1).max(200).parse(name);
 return tx.$queryRaw<Array<{id:string;name:string}>>`INSERT INTO lead_list(id,tenant_id,name) VALUES(${randomUUID()},${tenantId},${value}) ON CONFLICT(tenant_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id,name`;
}
export async function assignList(tx:Prisma.TransactionClient,tenantId:string,listId:string,contactId:string,remove=false){
 z.uuid().parse(listId);z.uuid().parse(contactId);
 const available=await tx.$queryRaw<Array<{id:string}>>`SELECT c.id FROM contact c JOIN lead_list l ON l.tenant_id=c.tenant_id WHERE c.id=${contactId} AND l.id=${listId}`;
 if(!available.length)throw new AccessError('LIST_OR_CONTACT_UNAVAILABLE',404);
 if(remove)await tx.$executeRaw`DELETE FROM list_member WHERE tenant_id=${tenantId} AND list_id=${listId} AND contact_id=${contactId}`;
 else await tx.$executeRaw`INSERT INTO list_member(tenant_id,list_id,contact_id) VALUES(${tenantId},${listId},${contactId}) ON CONFLICT DO NOTHING`;
}
