import 'server-only';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@/generated/prisma/client';
import {z} from 'zod';
import {companySchema,productSchema,factSchema,icpSchema,industryTemplates,postFilterFields} from '@/domain/profiles';
import {AccessError} from './policy';
const kindSchema=z.enum(['company_profile','product','product_fact','icp']);
export const profileInput=z.object({kind:kindSchema,id:z.uuid().optional(),productId:z.uuid().optional(),expectedVersion:z.number().int().min(0),data:z.unknown()}).strict();
type Row={id:string;tenant_id:string;data:unknown;version:number;updated_at:Date;product_id?:string};
export async function readProfiles(tx:Prisma.TransactionClient){
 const company=await tx.$queryRaw<Row[]>`SELECT tenant_id AS id,tenant_id,data,version,updated_at FROM company_profile`;
 const products=await tx.$queryRaw<Row[]>`SELECT * FROM product ORDER BY updated_at DESC`;
 const facts=await tx.$queryRaw<Row[]>`SELECT * FROM product_fact ORDER BY updated_at DESC`;
 const icps=await tx.$queryRaw<Row[]>`SELECT * FROM icp ORDER BY updated_at DESC`;
 return {company:company[0]??null,products,facts,icps,templates:industryTemplates,postFilterFields};
}
export async function saveProfile(tx:Prisma.TransactionClient,tenantId:string,raw:unknown){
 const input=profileInput.parse(raw);
 const schemas={company_profile:companySchema,product:productSchema,product_fact:factSchema,icp:icpSchema};
 const data=schemas[input.kind].parse(input.data);
 const id=input.kind==='company_profile'?tenantId:input.id??randomUUID();
 if(input.expectedVersion>0&&!input.id&&input.kind!=='company_profile')throw new AccessError('RECORD_ID_REQUIRED',400);
 if(input.expectedVersion===0&&input.id)throw new AccessError('NEW_RECORD_ID_NOT_ALLOWED',400);
 if((input.kind==='icp'||input.kind==='product_fact')&&input.expectedVersion===0){
  if(!input.productId)throw new AccessError('PRODUCT_REQUIRED',400);
  const products=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM product WHERE id=${input.productId} AND tenant_id=${tenantId}`;
  if(!products.length)throw new AccessError('PRODUCT_UNAVAILABLE',404);
 }
 // SQL identifiers are strictly selected from the internal enum, never free text.
 const table=Prisma.raw(input.kind),pk=Prisma.raw(input.kind==='company_profile'?'tenant_id':'id');
 const serialized=JSON.stringify(data);
 let rows:Row[];
 if(input.expectedVersion>0){
  rows=await tx.$queryRaw<Row[]>(Prisma.sql`UPDATE ${table} SET data=${serialized}::jsonb WHERE ${pk}=${id} AND tenant_id=${tenantId} AND version=${input.expectedVersion} RETURNING *`);
  if(!rows.length)throw new AccessError('VERSION_CONFLICT_OR_UNAVAILABLE',409);
 }else if(input.kind==='company_profile'){
  rows=await tx.$queryRaw<Row[]>`INSERT INTO company_profile(tenant_id,data) VALUES(${tenantId},${serialized}::jsonb) ON CONFLICT DO NOTHING RETURNING *`;
  if(!rows.length)throw new AccessError('VERSION_CONFLICT_OR_UNAVAILABLE',409);
 }else if(input.kind==='product'){
  rows=await tx.$queryRaw<Row[]>`INSERT INTO product(id,tenant_id,data) VALUES(${id},${tenantId},${serialized}::jsonb) RETURNING *`;
 }else{
  rows=await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO ${table}(id,tenant_id,product_id,data) VALUES(${id},${tenantId},${input.productId!},${serialized}::jsonb) RETURNING *`);
 }
 return {...rows[0],id};
}
export async function readRevisions(tx:Prisma.TransactionClient,kind:string,id:string){
 kindSchema.parse(kind);
 return tx.$queryRaw<Array<{version:number;data:unknown;created_at:Date}>>`SELECT version,data,created_at FROM profile_revision WHERE kind=${kind} AND record_id=${id} ORDER BY version DESC`;
}
export async function confirmedProductFacts(tx:Prisma.TransactionClient,productId:string){
 return tx.$queryRaw<Row[]>`SELECT * FROM product_fact WHERE product_id=${productId} AND data->>'status'='confirmed' AND length(btrim(data->>'source'))>0 ORDER BY id`;
}
