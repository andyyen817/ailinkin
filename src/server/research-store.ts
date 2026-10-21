import 'server-only';
import {randomUUID,createHash} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import {searchInput,searchTerms,type Campaign} from '@/domain/research';
import {AccessError} from './policy';
import {emptyLedger} from '../../scripts/research/schema.mjs';
import {analysisRow} from './company-analysis-store';
import {analysisSearchPlan,relatedExclusions,providerExclusions} from './analysis-search';
import {webProviderFor} from '../../scripts/research/search-capabilities.mjs';
import {saveSearchScope} from './search-scope-store';
import {saveOrganization} from './organization-assets';
import {observeSource,saveQualification} from './source-observations';
import {persistCampaignRequests,reuseAttempts} from '../../scripts/research/source-cache.mjs';
import {findCompany} from '../../scripts/research/company-identity.mjs';
import {linkResearchContact} from './research-contact-link';
import {inheritSourceHistory} from '../../scripts/research/discovery-history.mjs';
import {discoveryPolicy} from '@/domain/discovery-policy';
import {rememberSource} from '../../scripts/research/discovery-sources.mjs';
import {scopedApolloCredits} from '@/domain/shortlist-apollo-credits';
export {cachedRequest} from '../../scripts/research/source-cache.mjs';
import {searchHistory,resolveHistory} from './search-history';
export function inheritedCompany(old:any,historyId:string){
  return {...structuredClone(old),analysis:null,qualification:null,score:null,discovery:structuredClone(old.discovery||[]),
    reusedFromCampaigns:[historyId],analysisStatus:'当前画像待重新判断',status:'待核实',
    outreach:null,outreachAttemptHash:undefined,outreachStatus:'当前画像草稿待生成',
    outreachHistory:[...structuredClone(old.outreachHistory||[]),...(old.outreach?[structuredClone(old.outreach)]:[])]};
}
export async function campaigns(tx:Prisma.TransactionClient){
  return tx.$queryRaw<Campaign[]>`SELECT * FROM research_campaign ORDER BY created_at DESC LIMIT 20`;
}
export async function campaign(tx:Prisma.TransactionClient,id:string){
  const rows=await tx.$queryRaw<Campaign[]>`SELECT * FROM research_campaign WHERE id=${id}`;
  if(!rows.length)throw new AccessError('SEARCH_NOT_FOUND',404);
  return rows[0];
}
export async function createCampaign(tx:Prisma.TransactionClient,tenantId:string,userId:string,raw:unknown){
  const input=searchInput.parse(raw);let buyerGroup;
  if(!input.analysis)throw new AccessError('COMPANY_ANALYSIS_REQUIRED',409);
  if(input.analysis){
    const source=await analysisRow(tx,input.analysis.id);
    if(source.tenant_id!==tenantId)throw new AccessError('ANALYSIS_NOT_FOUND',404);
    if(source.version!==input.analysis.version)throw new AccessError('ANALYSIS_VERSION_CONFLICT',409);
    const {historyChoices: _choices, ...plan}=await analysisSearchPlan(tx,source,input.analysis.profileId,input.analysis.relatedCampaignIds,input.analysis.market);
    buyerGroup=plan;
    if(input.analysis.relatedCampaignIds)input.analysis.relatedCampaignIds=[...new Set(input.analysis.relatedCampaignIds)].sort();
    input.keywords=buyerGroup.keywords;input.country=buyerGroup.market;input.product=source.data.input.business.slice(0,200)||source.data.input.companyName;
  }
  if(!buyerGroup)throw new AccessError('COMPANY_ANALYSIS_REQUIRED',409);
  const policy=discoveryPolicy(input);
  const normalized={...input,...(policy?{discoveryPolicy:policy}:{}),keywords:searchTerms(input),webProvider:webProviderFor(input.country,process.env),
    discoveryMode:'exclude_rounds',entityDiscovery:true,buyerGroup};
  const key=createHash('sha256').update(JSON.stringify({...normalized,...(buyerGroup?{buyerGroup:{...buyerGroup,excludedDomains:undefined}}:{})})).digest('hex');
  const scopeId=await saveSearchScope(tx,tenantId,buyerGroup);
  const ledger:any=emptyLedger({...normalized,tenantId,scopeId});
  const related=resolveHistory(buyerGroup,await searchHistory(tx,tenantId),input.analysis?.relatedCampaignIds);
  const seen=new Set<string>();
  for(const history of related)for(const old of history.companies){
    if(!old.id||seen.has(old.id))continue;seen.add(old.id);
    const existing=findCompany(ledger.companies,old);
    if(existing){
      existing.reusedFromCampaigns.push(history.id);
      for(const source of old.discovery||[])if(!existing.discovery.some((s:any)=>JSON.stringify(s)===JSON.stringify(source)))existing.discovery.push(structuredClone(source));
      continue;
    }
    ledger.companies.push(inheritedCompany(old,history.id));
  }
  reuseAttempts(ledger,related);
  inheritSourceHistory(ledger,related);
  if(input.analysis){const source=await analysisRow(tx,input.analysis.id);
    const market=(source.data as any).marketResearch?.find((s:any)=>s.market===input.country);
    for(const saved of market?.sources||[])if(saved.url&&saved.kind!=='enterprise')rememberSource(ledger,{url:saved.url,title:saved.title,snippet:saved.text},'已保存市场研究资料','market_research',null);
  }
  const data=JSON.stringify(ledger);
  await tx.$executeRaw`INSERT INTO research_campaign(id,tenant_id,actor_id,input_hash,data) VALUES(${randomUUID()},${tenantId},${userId},${key},${data}::jsonb) ON CONFLICT(tenant_id,input_hash) DO NOTHING`;
  const rows=await tx.$queryRaw<Campaign[]>`SELECT * FROM research_campaign WHERE tenant_id=${tenantId} AND input_hash=${key}`;
  if(!rows.length)throw new AccessError('SEARCH_NOT_FOUND',404);
  return rows[0];
}
export async function claimCampaign(tx:Prisma.TransactionClient,id:string){
  let existing=await campaign(tx,id);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.tenant_id+'-search-claim'}))`;
  existing=await campaign(tx,id);
  if(existing.state==='running')throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
  const histories=await searchHistory(tx,existing.tenant_id);
  const group=existing.data.project.buyerGroup || {semanticKey:'legacy:'+id,market:existing.data.project.country};
  const related=resolveHistory(group,histories,[id]);
  if(related.some(h=>h.id!==id&&h.state==='running'))throw new AccessError('RELATED_SEARCH_ALREADY_RUNNING',409);
  if(existing.data.project.buyerGroup){
    const external=relatedExclusions(group.semanticKey,[],related.filter(h=>h.id!==id).flatMap(h=>h.companies));
    const exclusions=relatedExclusions(group.semanticKey,[],related.flatMap(h=>h.companies));
    const provider=existing.data.project.discoveryProvider==='apollo'?'apollo':existing.data.project.webProvider||webProviderFor(existing.data.project.country,process.env);
    existing.data.project.excludedDomains=providerExclusions(provider,exclusions);
    // A changed filter would invalidate Apollo's page offsets. Never silently skip or re-buy pages.
    const changed=(existing.data.batches||[]).some((b:any)=>b.provider==='apollo'&&b.nextPage>1&&external.some(d=>!(b.excludedDomains||[]).includes(d)));
    if(changed&&existing.data.project.discoveryMode!=='exclude_rounds')throw new AccessError('APOLLO_HISTORY_CHANGED',409);
  }
  const token=randomUUID();
  const rows=await tx.$queryRaw<Campaign[]>`UPDATE research_campaign SET data=${JSON.stringify(existing.data)}::jsonb,state='running',lease_token=${token},lease_until=now()+interval '10 minutes',version=version+1,updated_at=now() WHERE id=${id} AND version=${existing.version} RETURNING *`;
  if(!rows.length)throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
  return rows[0];
}
export async function saveCampaign(tx:Prisma.TransactionClient,row:Campaign,state:string,message:string){
  if(row.data.requests.some((r:any)=>r.service==='apollo'&&r.reservedCredits>0)){
    const limit=Number(process.env.RESEARCH_APOLLO_CREDIT_LIMIT||0);
    if(row.tenant_id!==process.env.RESEARCH_APOLLO_TENANT_ID||!(limit>0&&limit<=5))throw new AccessError('APOLLO_TRIAL_NOT_ENABLED',403);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${row.tenant_id+'-apollo-trial'}))`;
    const totals=await tx.$queryRaw<{used:number}[]>`SELECT COALESCE(SUM((r->>'reservedCredits')::int),0)::int AS used FROM research_campaign c CROSS JOIN LATERAL jsonb_array_elements(c.data->'requests') r WHERE c.tenant_id=${row.tenant_id} AND c.id<>${row.id}`;
    const own=row.data.requests.reduce((sum:number,r:any)=>sum+(r.reservedCredits||0),0);
    let authorizedIncrement=false;
    if(process.env.RESEARCH_SHORTLIST_ALTERNATIVE_SCOPE){
      const scope=JSON.parse(process.env.RESEARCH_SHORTLIST_ALTERNATIVE_SCOPE);
      if(scope.campaignIds?.includes(row.id)){
        const analysis=await analysisRow(tx,scope.analysisId);
        if(analysis.tenant_id!==row.tenant_id)throw new AccessError('ANALYSIS_NOT_FOUND',404);
        const others=await tx.$queryRaw<Campaign[]>`SELECT * FROM research_campaign WHERE tenant_id=${row.tenant_id} AND id=ANY(${scope.campaignIds}::text[])`;
        const budget=(analysis.data as any).sharedResearchBudgets?.find((b:any)=>b.id===scope.sharedBudget.id);
        scopedApolloCredits(scope,row,budget,others);authorizedIncrement=true;
      }
    }
    if(!authorizedIncrement&&totals[0].used+own>limit){
      for(const r of row.data.requests.filter((r:any)=>r.status==='pending'))Object.assign(r,{status:'blocked_before_send',reservedCredits:0,reservedCost:0,enrichmentPeople:0});
      throw new AccessError('APOLLO_CREDIT_LIMIT',409);
    }
    const month=new Date();month.setUTCDate(1);month.setUTCHours(0,0,0,0);
    const people=await tx.$queryRaw<{used:number}[]>`SELECT COALESCE(SUM((r->>'enrichmentPeople')::int),0)::int AS used
      FROM research_campaign c CROSS JOIN LATERAL jsonb_array_elements(c.data->'requests') r
      WHERE c.tenant_id=${row.tenant_id} AND c.id<>${row.id} AND r->>'startedAt'>=${month.toISOString()}`;
    const current=row.data.requests.filter((r:any)=>r.startedAt>=month.toISOString()).reduce((n:number,r:any)=>n+(r.enrichmentPeople||0),0);
    if(people[0].used+current>500){
      for(const r of row.data.requests.filter((r:any)=>r.status==='pending'))Object.assign(r,{status:'blocked_before_send',reservedCredits:0,reservedCost:0,enrichmentPeople:0});
      throw new AccessError('CONTACT_MONTHLY_LIMIT',409);
    }
  }
  for(const company of row.data.companies){
    if(!company.assetId){
      const key=company.apolloId?'apollo:'+company.apolloId:company.website?'site:'+new URL(company.website).hostname:'pending:'+company.id;
      const asset=await saveOrganization(tx,row.tenant_id,{canonicalKey:key,name:company.name||key,website:company.website||''});
      company.assetId=asset.id;
    }
    for(const source of company.discovery||[]){
      if(source.assetObservationId)continue;
      const observed=await observeSource(tx,row.tenant_id,{organizationId:company.assetId,provider:source.provider||'web',
        url:source.url||company.source,snapshot:source});
      source.assetObservationId=observed.id;
    }
    if(company.entityId&&company.qualification)await saveQualification(tx,row.tenant_id,company.assetId,company.qualification);
  }
  for(const person of row.data.contacts.filter((p:any)=>p.employerVerified&&!p.crmContactId)){
    const company=row.data.companies.find((c:any)=>c.id===person.companyId);
    if(company){
      const linked=await linkResearchContact(tx,row.tenant_id,company,person);
      person.crmContactId=linked.contactId;person.suppressed ||= linked.doNotContact;
    }
  }
  await persistCampaignRequests(tx,row.tenant_id,row.data.project.scopeId,row.data.requests);
  const data=JSON.stringify(row.data);
  const rows=await tx.$queryRaw<Campaign[]>`UPDATE research_campaign SET data=${data}::jsonb,state=${state},message=${message},version=version+1,updated_at=now(),lease_token=CASE WHEN ${state}='running' THEN lease_token ELSE NULL END,lease_until=CASE WHEN ${state}='running' THEN now()+interval '10 minutes' ELSE NULL END WHERE id=${row.id} AND version=${row.version} AND lease_token IS NOT DISTINCT FROM ${row.lease_token} RETURNING *`;
  if(!rows.length)throw new AccessError('SEARCH_VERSION_CONFLICT',409);
  Object.assign(row,rows[0]);return row;
}
