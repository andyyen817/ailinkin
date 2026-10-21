import 'server-only';
import {createHash} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import type {Campaign} from '@/domain/research';
import {saveOrganization} from './organization-assets';
import {observeSource} from './source-observations';
import {AccessError} from './policy';

// Linking creates references; it never rewrites the historical campaign or its judgments.
export async function linkLegacyCampaign(tx:Prisma.TransactionClient,tenantId:string,id:string){
  const [row]=await tx.$queryRaw<Campaign[]>`SELECT * FROM research_campaign WHERE id=${id} AND tenant_id=${tenantId}`;
  if(!row)throw new AccessError('SEARCH_NOT_FOUND',404);
  if(row.data.companies.length>1000)throw new AccessError('LEGACY_LINK_LIMIT',409);
  const originalHash=createHash('sha256').update(JSON.stringify(row.data)).digest('hex');
  const links=[];
  for(const c of row.data.companies){
    let website='';
    try{const u=new URL(c.website);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)website=u.href;}catch{}
    const key=c.apolloId?'apollo:'+c.apolloId:website?'site:'+new URL(website).hostname:'legacy:'+id+':'+c.id;
    const asset=await saveOrganization(tx,tenantId,{canonicalKey:key,name:c.name||key,website});
    const sources=[];const unresolved=[];
    for(const source of c.discovery||[]){
      let url='';try{const u=new URL(source.url||c.source);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)url=u.href;}catch{}
      if(!url){unresolved.push('来源地址待核实');continue;}
      const observed=await observeSource(tx,tenantId,{organizationId:asset.id,provider:source.provider||'legacy',url,snapshot:source});
      sources.push(observed.id);
    }
    links.push({legacyId:c.id,assetId:asset.id,market:row.data.project.country,status:'pending',sources,unresolved});
  }
  return {campaignId:id,market:row.data.project.country,originalHash,links};
}
