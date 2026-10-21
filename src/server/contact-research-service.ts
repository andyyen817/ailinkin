import 'server-only';
import {createHash} from 'node:crypto';
import {AccessError} from './policy';
import type {Campaign} from '@/domain/research';
import {contactResearchInput,accountFinding} from '@/domain/contact-research';
import {cachedSocialAccounts,socialQueries,socialPlanBasis} from '../../scripts/research/social-account-locator.mjs';
import {companyContactRoutes} from '../../scripts/research/company-contact-routes.mjs';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function prepareContactResearch(row:Campaign,tenantId:string,raw:unknown,now=Date.now()){
  const input=contactResearchInput.parse(raw),d=row.data,group=d.project.buyerGroup;
  if(row.tenant_id!==tenantId||d.project.tenantId!==tenantId||input.campaignId!==row.id)throw new AccessError('SEARCH_NOT_FOUND',404);
  if(row.state==='running')throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
  if(d.requests.some((r:any)=>['pending','unknown'].includes(r.status)))throw new AccessError('REQUEST_PENDING_OR_UNKNOWN',409);
  if(!group?.ready||!group.analysisId)throw new AccessError('CURRENT_COMPANY_ANALYSIS_REQUIRED',409);
  const platforms=[...new Set(input.platforms)].sort(),companyIds=[...new Set(input.companyIds)].sort();
  const companies=companyIds.map(companyId=>{
    const c=d.companies.find((c:any)=>c.id===companyId&&!c.sourceOnly),entity=d.sourcePipeline?.entities.find((e:any)=>e.companyId===companyId&&e.ownership?.verified);
    if(!c||!entity||c.qualification?.status!=='qualified')throw new AccessError('QUALIFIED_OFFICIAL_BUYER_REQUIRED',409);
    const accounts=cachedSocialAccounts(entity,c,platforms,now).map((a:any)=>accountFinding.parse(a)),queries=socialQueries(c,platforms,accounts);
    const routes=companyContactRoutes(entity,new Date(now));
    return {companyId,name:c.name,website:c.website,accounts,queries,channels:routes.routes,
      people:[],purchaseAuthority:'unknown',purchaseIntent:'unknown',roles:group.decisionRoles||[],
      platformStates:platforms.map(platform=>({platform,state:platform==='网页'?'saved_official_pages':accounts.some((a:any)=>a.platform===platform)?'saved_account_link':'needs_search',
        notice:platform==='网页'?'复用已保存官网；没有新读取':accounts.some((a:any)=>a.platform===platform)?'官网指向的账号候选；社媒正文和人员尚未研究':'尚无保存账号；查询尚未发送'})),
      basis:socialPlanBasis(c,platforms,accounts,queries)+':'+routes.basisHash};
  });
  const dependencyHash=hash([1,group.analysisId,group.analysisVersion,companyIds,platforms,companies.map(c=>c.basis)]);
  const previous=(d.contactResearchPlans||[]).find((p:any)=>p.dependencyHash===dependencyHash);
  if(previous)return {plan:previous,reused:true,externalRequests:0,sent:0};
  if((d.contactResearchPlans||[]).length>=50)throw new AccessError('CONTACT_PLAN_LIMIT_REQUIRES_REVIEW',409);
  const plan={id:'CR-'+dependencyHash.slice(0,24),schemaVersion:'company-social-v1',campaignId:row.id,
    analysisId:group.analysisId,analysisVersion:group.analysisVersion,companyIds,platforms,dependencyHash,
    createdAt:new Date(now).toISOString(),mode:'saved_only',state:'prepared',companies,
    counts:{companies:companies.length,accounts:companies.reduce((n,c)=>n+c.accounts.length,0),channels:companies.reduce((n,c)=>n+c.channels.length,0),people:0,
      pendingQueries:companies.reduce((n,c)=>n+c.queries.length,0)},
    limits:{searchRequests:0,pageReads:0,screenshots:0,modelRequests:0,apolloCredits:0,maxSpendUsd:0},
    blockers:['本轮仅整理已保存官网账号与联系渠道。新查询、社媒正文读取、截图和模型识别尚未执行，需要相应执行器及明确调用范围。'],
    externalRequests:0,sent:0};
  (d.contactResearchPlans||=[]).push(plan);
  return {plan,reused:false,externalRequests:0,sent:0};
}
export function savedContactResearch(row:Campaign){return {plans:row.data.contactResearchPlans||[],externalRequests:0,sent:0};}
