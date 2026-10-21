import 'server-only';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {Campaign} from '@/domain/research';
import {contactBatchInput,contactBatchScope} from '@/domain/contact-batch';
import {enterpriseSelectionView} from './enterprise-selection';
import {withTenant} from './tenant';
import {campaign} from './research-store';
import {persistContactReview} from './contact-review-service';
import {AccessError} from './policy';
import {putContactImage,readContactImage} from './contact-evidence-store';
import {createContactBatch,advanceContactBatch,recoverContactBatch,batchUsage} from '../../scripts/research/contact-batch.mjs';
import {cachedSocialAccounts,accountUrl} from '../../scripts/research/social-account-locator.mjs';
import {executeContactResearch} from '../../scripts/research/contact-research.mjs';
import {savedOfficialContactPage} from '../../scripts/research/contact-official-fallback.mjs';
import {transport} from '../../scripts/research/http.mjs';
import {langsearch} from '../../scripts/research/langsearch.mjs';
import {preciseContactQueries} from './contact-query-plan';
import {sharedBudgetGuard} from './shared-research-budget';
import {rememberContactSearch} from './contact-search-evidence';
import {executeContactPool,recoverKnownContactPools} from '../../scripts/research/contact-pool-execution.mjs';
import {discoveryCandidates} from '../../scripts/research/contact-discovery.mjs';
import {platformCatalog} from '../../scripts/research/platform-catalog.mjs';
import {deepContactCoverage} from '../../scripts/research/contact-coverage.mjs';
import {savedExactContactPage} from '../../scripts/research/contact-page-cache.mjs';
import {resolveContactBatchScope} from '@/domain/contact-batch-scopes';
import {readSocialPage} from '../../scripts/research/social-page-reader.mjs';
export async function readBatchScope(campaignId?:string){try{return resolveContactBatchScope(JSON.parse(await fs.readFile(/* turbopackIgnore: true */ process.env.CONTACT_BATCH_SCOPE_PATH||'.runtime/contact-batch-scope.json','utf8')),campaignId);}catch{return null;}}
export const batchRestoreState=(row:Campaign)=>row.data.contactBatchLease?.priorState||row.state;
export const batchModelAllowance=(approved:any,usage:any)=>usage.modelRequests<approved.maxModelRequests&&usage.reservedUsd+0.05<=approved.maxSpendUsd;
export function batchExecutionStatus(row:Campaign,batch:any,scope:any){
  const sharedAllowed=!scope?.sharedBudget||(scope.sharedBudget.analysisId===row.data.project.analysis?.id&&Date.now()+60000<Date.parse(scope.sharedBudget.expiresAt)&&Date.parse(scope.sharedBudget.expiresAt)<=Date.parse(scope.expiresAt));
  const policyAllowed=!scope?.publicDiscovery||(scope.publicDiscovery.companyIds.every((id:string)=>batch.companyIds.includes(id))&&scope.publicDiscovery.platforms.every((p:string)=>batch.platforms.includes(p)));
  const selection=enterpriseSelectionView(row),enabled=!!(scope&&policyAllowed&&scope.tenantId===row.tenant_id&&scope.campaignId===row.id&&scope.batchId===batch.id&&scope.selectionId===batch.selectionId&&
    selection.confirmation?.valid&&selection.confirmation.id===batch.selectionId&&Date.now()+60000<Date.parse(scope.expiresAt)&&sharedAllowed);
  return {enabled,usage:batchUsage(row.data,batch),coverage:deepContactCoverage(row.data,batch),scope:enabled?{id:scope.id,maxSearchRequests:scope.maxSearchRequests,maxPageReads:scope.maxPageReads,maxModelRequests:scope.maxModelRequests,maxSpendUsd:scope.maxSpendUsd,expiresAt:scope.expiresAt}:null};
}
export function prepareContactBatch(row:Campaign,tenantId:string,raw:unknown){
  const input=contactBatchInput.parse(raw);if(input.action!=='prepare')throw new AccessError('INVALID_INPUT',400);
  if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId||row.id!==input.campaignId)throw new AccessError('SEARCH_NOT_FOUND',404);
  if(row.state==='running'||row.data.operatorLease||row.data.contactBatchLease||row.data.contactLease)throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
  const selection=enterpriseSelectionView(row);if(selection.confirmation?.id!==input.selectionId||!selection.confirmation.valid)throw new AccessError('ENTERPRISE_SELECTION_STALE',409);
  const accounts:any={};for(const id of selection.selected){const c=row.data.companies.find((c:any)=>c.id===id),entity=c&&row.data.sourcePipeline?.entities.find((e:any)=>e.companyId===id&&e.ownership?.verified);
    accounts[id]=entity?cachedSocialAccounts(entity,c,input.platforms):[];}
  const companies=selection.selected.map((id:string)=>({companyId:id,name:row.data.companies.find((c:any)=>c.id===id)?.name,accounts:accounts[id]}));
  return createContactBatch(row.data,selection,input.platforms,accounts,Date.now(),preciseContactQueries(row,companies).queries);
}
export async function runContactBatch(request:Request,tenantId:string,raw:unknown){
  const input=contactBatchInput.parse(raw);if(input.action==='prepare')throw new AccessError('INVALID_INPUT',400);
  const scope=await readBatchScope(input.campaignId),token=randomUUID();
  const {row,batch,priorState}=await withTenant(request,tenantId,async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':contact-batch:'+input.campaignId}))`;const row=await campaign(tx,input.campaignId),batch=row.data.contactBatches?.find((b:any)=>b.id===input.batchId);
    if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId||!batch)throw new AccessError('SEARCH_NOT_FOUND',404);
    const priorState=batchRestoreState(row);
    if(input.action==='recover'){
      if(row.data.contactBatchLease&&Date.parse(row.data.contactBatchLease.until)>Date.now())throw new AccessError('CONTACT_BATCH_STILL_RUNNING',409);
      recoverContactBatch(row.data,batch);recoverKnownContactPools(row.data,batch);delete row.data.contactBatchLease;
    }else if(row.state==='running'||row.data.operatorLease||row.data.contactBatchLease||row.data.contactLease)throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
    if(input.action==='run'&&!batchExecutionStatus(row,batch,scope).enabled)throw new AccessError('CONTACT_BATCH_SCOPE_REQUIRED',403);
    row.data.contactBatchLease={token,priorState,until:new Date(Date.now()+180000).toISOString()};
    const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state='running',lease_token=${token},lease_until=now()+interval '3 minutes',version=version+1,updated_at=now()
      WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version}`;
    if(n!==1)throw new AccessError('SEARCH_VERSION_CONFLICT',409);row.version++;row.state='running';return {row,batch,priorState};
  },true);
  const beforeSend=input.action==='run'?sharedBudgetGuard(request,tenantId,scope,row.data.project.analysis?.id):undefined;
  const checkpoint=async()=>withTenant(request,tenantId,async tx=>{
    const held=!!row.data.contactBatchLease;
    const n=await tx.$executeRaw`UPDATE research_campaign SET data=${JSON.stringify(row.data)}::jsonb,state=${held?'running':priorState},lease_token=${held?token:null},lease_until=${held?new Date(Date.now()+180000):null},version=version+1,updated_at=now()
      WHERE id=${row.id} AND tenant_id=${tenantId} AND version=${row.version} AND data->'contactBatchLease'->>'token'=${token}`;
    if(n!==1)throw new AccessError('CONTACT_BATCH_LEASE_LOST',409);row.version++;
  },true);
  try{
    if(input.action!=='recover')await advanceContactBatch(row.data,batch,enterpriseSelectionView(row),{scope,cachedOnly:input.action==='reuse',checkpoint,
      executeCompany:(company:any,approved:any)=>executeContactPool(row.data,company,batch,approved,checkpoint,{campaignId:row.id,
        keys:{DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY},beforeSend,loadImage:(id:string)=>readContactImage(tenantId,id)}),
      executeUnit:async(unit:any,approved:any,usage:any)=>{
        const company=row.data.companies.find((c:any)=>c.id===unit.companyId);if(!company)throw new AccessError('CONTACT_COMPANY_NOT_READY',409);
        const modelAllowed=false;
        const unitScope={id:'CONTACT-'+(await import('node:crypto')).createHash('sha256').update(approved.id+batch.id+unit.id).digest('hex').slice(0,32).toUpperCase(),enabled:true,
          tenantId,campaignId:row.id,companyId:company.id,platform:unit.platform,url:unit.url,approvedAt:approved.approvedAt,expiresAt:approved.expiresAt,
          pageReads:1,modelRequests:modelAllowed?1:0,screenshots:approved.screenshotsPerPage,maxSpendUsd:modelAllowed?0.05:0,
          model:'deepseek-flash',browser:true,send:false,savedOfficialFallback:true};
        const save=async()=>{for(const run of row.data.contactResearchRuns||[])if(run.scopeId===unitScope.id)run.batchId=batch.id;await checkpoint();};
        const page=unit.platform==='网页'?savedExactContactPage(row.data,company,unit.url):null;
        let network=0;
        return executeContactResearch(row.data,{tenantId,campaignId:row.id,company,account:unit.account,scope:unitScope},save,{
          keys:{DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY},beforeSend,...(page?{savedPage:page}:{}),
          readPage:(url:string,options:any)=>readSocialPage(url,{...options,beforeRequest:()=>beforeSend?.({service:'public_network',requestKey:unitScope.id+':network:'+ ++network,reservedCost:0})}),
          putImage:(bytes:Buffer)=>putContactImage(tenantId,bytes),loadImage:(id:string)=>readContactImage(tenantId,id)});
      },searchAccounts:async(unit:any,approved:any,current:any)=>{
        const ledger={requests:current.requests,project:{maxRequests:approved.maxSearchRequests,maxSpendUsd:approved.maxSpendUsd}},call=transport(ledger,{keys:{LANGSEARCH_API_KEY:process.env.LANGSEARCH_API_KEY},live:true,costUpperBound:{langsearch:0},cacheSeconds:{langsearch:86400},beforeSend},checkpoint);
        const hits=await langsearch(call,unit.query,[],20,2500,approved.publicDiscovery?platformCatalog[unit.platform]?.domains||[]:[]);rememberContactSearch(row.data,unit,hits);call.commit();await checkpoint();
        if(unit.sourceQuality.returned>0&&unit.sourceQuality.admitted===0)throw Error('CONTACT_SEARCH_RELEVANCE_FAILED');
        if(approved.publicDiscovery){const company=row.data.companies.find((c:any)=>c.id===unit.companyId);return discoveryCandidates(unit,hits,company);}
        return hits.flatMap((h:any)=>{const a=accountUrl(h.url);if(!a||a.platform!==unit.platform||!h.snippet?.toLowerCase().includes(unit.companyName.toLowerCase()))return [];
          return [{companyId:unit.companyId,platform:unit.platform,url:a.url,ownership:'unconfirmed',ownerType:'unknown',readState:'not_started',identityNotice:'搜索找到账号，归属待核实',
            evidence:[{id:unit.id,sourceUrl:h.url,quote:h.snippet,retrievedAt:new Date().toISOString(),contentHash:(awaitHash(h.snippet))}]}];});
      }});
    delete row.data.contactBatchLease;row.state=priorState;await checkpoint();return {batch,execution:batchExecutionStatus(row,batch,scope),sent:0};
  }catch(e){delete row.data.contactBatchLease;await checkpoint().catch(()=>{});throw e;}
}
import {createHash} from 'node:crypto';
const awaitHash=(v:string)=>createHash('sha256').update(v).digest('hex');
