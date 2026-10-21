import 'server-only';
import {stringify} from 'csv-stringify/sync';
import type {Prisma} from '@/generated/prisma/client';
import type {Campaign} from '@/domain/research';
import {AccessError} from './policy';
import {linkResearchContact} from './research-contact-link';
import {observeSource} from './source-observations';
export function contactAssetCsv(row:Campaign){
  const values:any[][]=[];
  for(const run of row.data.contactResearchRuns||[]){
    for(const p of run.people||[])values.push([run.companyName,'人员候选',p.name,p.title,p.relationship,'任职及采购权未确认',p.crmContactId||'',
      p.evidence.map((e:any)=>e.sourceUrl+' '+e.quote).join('；'),run.page?.method||run.platform,run.outcome?.label||'待核实']);
    for(const c of run.channels||[])values.push([run.companyName,'公开联系渠道',c.value,c.kind,c.scope,'可联系性及归属待核实','',
      c.evidence.map((e:any)=>e.sourceUrl+' '+e.quote).join('；'),run.page?.method||run.platform,run.outcome?.label||'待核实']);
  }
  const safe=(v:unknown)=>{const text=String(v??'');return /^[\s]*[=+@-]/.test(text)?"'"+text:text;};
  return '\uFEFF'+stringify([['研究企业','资料类型','姓名或联系值','职位或渠道','关系或范围','核实状态','CRM编号','出处及原文','实际资料来源','任务成果'],...values.map(v=>v.map(safe))]);
}
export function salesCandidatePeople(run:any){
  return (run.people||[]).filter((p:any)=>p.name&&p.evidence?.some((e:any)=>e.quote?.includes(p.name)&&/^https?:\/\//.test(e.sourceUrl||'')));
}
export async function saveContactCandidates(tx:Prisma.TransactionClient,row:Campaign,tenantId:string,runId:string){
  if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);
  if(row.state==='running')throw new AccessError('CONTACT_RESEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
  const run=(row.data.contactResearchRuns||[]).find((r:any)=>r.id===runId),company=run&&row.data.companies.find((c:any)=>c.id===run.companyId&&c.qualification?.status==='qualified');
  if(!run||!company||!company.assetId)throw new AccessError('CONTACT_RUN_NOT_READY',409);
  const people=salesCandidatePeople(run);
  let saved=0;const contacts=[];
  for(const p of people){
    const linked=await linkResearchContact(tx,tenantId,company,p);if(!p.crmContactId){p.crmContactId=linked.contactId;saved++;}
    contacts.push(linked.contactId);
    for(const e of p.evidence)await observeSource(tx,tenantId,{organizationId:company.assetId,provider:'social_contact',url:e.sourceUrl,
      kind:'person_data',snapshot:{sourcePersonId:p.sourcePersonId,name:p.name,title:p.title,relationship:p.relationship,employerVerified:false,purchaseAuthority:'unknown',
        employerClaim:p.employerClaim,employmentDates:p.employmentDates,careerHistory:p.careerHistory,contacts:p.contacts,evidence:e}});
  }
  if(saved){const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,version=version+1,updated_at=now()
    WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version} AND state<>'running'`;if(n!==1)throw new AccessError('SEARCH_VERSION_CONFLICT',409);}
  return {saved,contacts,reused:saved===0,excludedMentioned:run.people.length-people.length,confirmedProcurementPeople:0,sent:0};
}
