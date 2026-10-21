import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import {z} from 'zod';
import {qualificationSchema} from '@/domain/qualification';
const sourceSchema=z.object({organizationId:z.string().min(1),provider:z.string().min(1),
  url:z.url(),snapshot:z.record(z.string(),z.unknown()),
  kind:z.enum(['organization_fact','person_data','private_note','communication']).default('organization_fact'),
}).strict();
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export async function observeSource(tx:Prisma.TransactionClient,tenantId:string,raw:unknown){
  const s=sourceSchema.parse(raw),content=JSON.stringify(canonical(s.snapshot));
  if(content.length>200000)throw Error('SOURCE_SNAPSHOT_TOO_LARGE');
  const hash=createHash('sha256').update(content).digest('hex');
  await tx.$executeRaw`INSERT INTO source_observation(id,tenant_id,organization_id,provider,source_url,content_hash,snapshot,kind)
    VALUES(${randomUUID()},${tenantId},${s.organizationId},${s.provider},${s.url},${hash},${content}::jsonb,${s.kind})
    ON CONFLICT(tenant_id,organization_id,provider,source_url,content_hash) DO NOTHING`;
  const [result]=await tx.$queryRaw<{id:string;content_hash:string}[]>`SELECT id,content_hash FROM source_observation
    WHERE tenant_id=${tenantId} AND organization_id=${s.organizationId} AND provider=${s.provider}
      AND source_url=${s.url} AND content_hash=${hash}`;
  if(!result)throw Error('SOURCE_NOT_AVAILABLE');return result;
}
export async function saveQualification(tx:Prisma.TransactionClient,tenantId:string,organizationId:string,raw:unknown){
  const q=JSON.stringify(qualificationSchema.parse(raw));
  await tx.$executeRaw`INSERT INTO tenant_organization(tenant_id,organization_id,qualification)
    VALUES(${tenantId},${organizationId},${q}::jsonb) ON CONFLICT(tenant_id,organization_id)
    DO UPDATE SET qualification=EXCLUDED.qualification,version=tenant_organization.version+1,updated_at=now()`;
}
