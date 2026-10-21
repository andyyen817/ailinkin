import 'server-only';
import type {Prisma} from '@/generated/prisma/client';
import {contactSchema} from '@/domain/contacts';
import {importContact} from './contacts';
import {AccessError} from './policy';
import {createHash} from 'node:crypto';
export function researchPersonIdentity(company:any,person:any){
  if(person.apolloId&&person.employerVerified)return {providerId:person.apolloId,candidate:false};
  const key='social:'+createHash('sha256').update(JSON.stringify([company.id,person.profileUrl||String(person.name).normalize('NFKC').toLowerCase()])).digest('hex').slice(0,40);
  if(person.sourcePersonId!==key||person.companyId!==company.id||!person.name||!Array.isArray(person.evidence)||
    !person.evidence.some((e:any)=>e.quote?.includes(person.name))||!person.evidence.every((e:any)=>/^https?:\/\//.test(e.sourceUrl||'')&&/^[a-f0-9]{64}$/.test(e.contentHash||'')))throw new AccessError('CONTACT_IDENTITY_NOT_READY',409);
  return {providerId:key,candidate:true};
}
export async function linkResearchContact(tx:Prisma.TransactionClient,tenantId:string,company:any,person:any){
  if(!company.assetId)throw new AccessError('CONTACT_IDENTITY_NOT_READY',409);
  const identity=researchPersonIdentity(company,person);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId+'-research-person'},0))`;
  const [link]=await tx.$queryRaw<{contact_id:string}[]>`SELECT contact_id FROM research_contact_link
    WHERE tenant_id=${tenantId} AND provider_person_id=${identity.providerId}`;
  const data=contactSchema.parse({name:person.name,company:company.name,title:person.title||'',country:identity.candidate?'':company.country==='未知'?'':company.country||'',
    email:identity.candidate?'':person.email||'',emailStatus:'unverified',doNotContact:!!(person.suppressed||company.doNotContact),
    ...(identity.candidate?{stage:'待筛选',tags:['社媒人员候选','任职待核实'],notes:'研究目标企业（不代表现任雇主）：'+company.name+'；关系：'+(person.relationship||'未知')+'；职业经历与联系路径交给销售判断。\n'+person.evidence.map((e:any)=>e.sourceUrl+'：'+e.quote).join('\n').slice(0,8000)}:{})});
  let contactId=link?.contact_id;
  if(!contactId){
    if(data.email){
      const [old]=await tx.$queryRaw<{data:{name:string}}[]>`SELECT data FROM contact WHERE email=${data.email}`;
      if(old&&old.data.name.normalize('NFKC').toLowerCase()!==data.name.normalize('NFKC').toLowerCase())throw new AccessError('CONTACT_IDENTITY_CONFLICT',409);
    }
    const result=await importContact(tx,tenantId,data,'fill_empty');contactId=result.record.id;
  }
  const observations=JSON.stringify({candidate:identity.candidate,purchaseAuthority:identity.candidate?'unknown':person.purchaseAuthority,evidence:person.evidence,profileUrl:person.profileUrl,relationship:person.relationship,
    source:person.source,emailSource:person.emailSource,emailStatus:person.emailStatus,
    phone:person.phone,phoneType:person.phoneType,phoneSource:person.phoneSource,employerEvidence:person.employerEvidence,observedAt:person.updatedAt,
    employerClaim:person.employerClaim,employmentDates:person.employmentDates,careerHistory:person.careerHistory,contacts:person.contacts});
  await tx.$executeRaw`INSERT INTO research_contact_link(tenant_id,provider_person_id,organization_id,contact_id,observations)
    VALUES(${tenantId},${identity.providerId},${company.assetId},${contactId},${observations}::jsonb)
    ON CONFLICT(tenant_id,provider_person_id) DO UPDATE SET observations=EXCLUDED.observations,updated_at=now()`;
  const [saved]=await tx.$queryRaw<{data:{doNotContact:boolean}}[]>`SELECT data FROM contact WHERE id=${contactId}`;
  return {contactId,doNotContact:saved?.data.doNotContact??true};
}
