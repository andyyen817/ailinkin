import 'server-only';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import {z} from 'zod';
import {AccessError} from './policy';
const inputSchema=z.object({canonicalKey:z.string().trim().min(1).max(800),
  name:z.string().trim().min(1).max(500),website:z.union([z.literal(''),z.url()]).default(''),
  aliases:z.array(z.object({kind:z.enum(['domain','apollo_id','registry_id']),value:z.string().trim().min(1).max(800)}).strict()).max(10).default([]),
}).strict();
export type OrganizationAsset={id:string;tenant_id:string;canonical_key:string;name:string;website:string;identity_state:string};
export async function saveOrganization(tx:Prisma.TransactionClient,tenantId:string,raw:unknown){
  const input=inputSchema.parse(raw);
  const [asset]=await tx.$queryRaw<OrganizationAsset[]> `INSERT INTO organization_asset(id,tenant_id,canonical_key,name,website)
    VALUES(${randomUUID()},${tenantId},${input.canonicalKey},${input.name},${input.website})
    ON CONFLICT(tenant_id,canonical_key) DO UPDATE SET updated_at=now() RETURNING *`;
  if(!asset)throw new AccessError('ORGANIZATION_NOT_AVAILABLE',404);
  for(const alias of input.aliases){
    const existing=await tx.$queryRaw<{organization_id:string}[]> `SELECT organization_id FROM organization_alias
      WHERE tenant_id=${tenantId} AND kind=${alias.kind} AND value=${alias.value}`;
    if(existing.length&&existing[0].organization_id!==asset.id)throw new AccessError('ORGANIZATION_ALIAS_CONFLICT',409);
    await tx.$executeRaw`INSERT INTO organization_alias(tenant_id,organization_id,kind,value)
      VALUES(${tenantId},${asset.id},${alias.kind},${alias.value}) ON CONFLICT DO NOTHING`;
  }
  return asset;
}
export async function organizationAssets(tx:Prisma.TransactionClient,tenantId:string,keys:string[]){
  if(keys.length>100)throw new AccessError('ASSET_LOOKUP_LIMIT',400);
  if(!keys.length)return [];
  return tx.$queryRaw<OrganizationAsset[]>`SELECT * FROM organization_asset
    WHERE tenant_id=${tenantId} AND canonical_key=ANY(${keys}::text[]) ORDER BY canonical_key`;
}
