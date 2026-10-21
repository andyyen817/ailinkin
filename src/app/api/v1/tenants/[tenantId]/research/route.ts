import {z} from 'zod';
import {stringify} from 'csv-stringify/sync';
import {withTenant} from '@/server/tenant';
import {json,failure,mutationOrigin} from '@/server/http';
import {campaigns,campaign,createCampaign,claimCampaign,saveCampaign,cachedRequest} from '@/server/research-store';
import {connectionStatus,executeSearch,present,providerConfig} from '@/server/research-response';
import {relatedExclusions} from '@/server/analysis-search';
import {sharedBudgetGuard} from '@/server/shared-research-budget';
import {targetMilestone} from '../../../../../../../scripts/research/target-milestone.mjs';
import {platformsFor} from '../../../../../../../scripts/research/platform-catalog.mjs';
export const runtime='nodejs';
export const maxDuration=240;
type Context={params:Promise<{tenantId:string}>};
const milestoneFor=(row:any,rows:any[])=>targetMilestone(rows.filter(r=>r.data.project.analysis?.id===row.data.project.analysis?.id&&
  r.data.project.buyerGroup?.application===row.data.project.buyerGroup?.application));
export async function GET(request:Request,context:Context){
  try{
    const {tenantId}=await context.params,url=new URL(request.url),id=url.searchParams.get('id');
    const all=await withTenant(request,tenantId,tx=>campaigns(tx));
    const rows=id?[await withTenant(request,tenantId,tx=>campaign(tx,z.uuid().parse(id)))]:all;
    if(url.searchParams.get('export')==='csv'){
      if(!id)return json({error:'SEARCH_ID_REQUIRED'},400);
      const item=present(rows[0]);
      const csvPlatforms=platformsFor(item.project);
      const safe=(s:unknown)=>{const v=String(s??'');return /^[\s]*[=+@-]/.test(v)?"'"+v:v;};
      const fields=['公司','目标市场','官网','来源',...csvPlatforms,'邮箱','邮箱状态','匹配理由','合作假设','信件草稿','搜索标题','搜索摘要','搜索关键词','搜索供应商','地区线索','来源类型','黄铜业务依据','地区依据','电话','联系方式来源','Apollo企业ID','匹配状态','匹配依据','供应商行业','供应商员工数','企业所在地','有效判定','官网事实依据'];
      const values=item.companies.map((c:any)=>[c.name,c.targetMarket,c.website,c.source,...c.platforms.map((p:any)=>p.status),c.contacts.map((p:any)=>p.email).filter(Boolean).join("；"),c.contacts.map((p:any)=>p.emailStatus).filter(Boolean).join("；"),c.analysis?.fit,c.analysis?.pain,c.analysis?.draft,c.discovery[0]?.title,c.discovery[0]?.summary,c.discovery[0]?.query,c.discovery[0]?.provider,c.city,c.profile?.sourceType,c.profile?.productEvidence,c.profile?.regionEvidence,c.contacts.map((p:any)=>p.phone).filter(Boolean).join("；"),c.contacts.map((p:any)=>p.source).filter(Boolean).join("；"),c.apolloId,c.fitStatus,c.fitReason,c.industry,c.employees,c.country,c.qualification?.status,c.qualification?.evidence?.map((e:any)=>e.url+' '+e.quote).join('；')].map(safe));
      return new Response('\uFEFF'+stringify([fields,...values]),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="research.csv"','Cache-Control':'no-store'}});
    }
    return json({campaigns:rows.map(row=>present(row,milestoneFor(row,all))),connections:connectionStatus()});
  }catch(e){return failure(e);}
}
export async function POST(request:Request,context:Context){
  try{
    mutationOrigin(request);const {tenantId}=await context.params;
    const text=await request.text();if(text.length>60000)return json({error:'INPUT_TOO_LARGE'},413);
    const input=z.discriminatedUnion('action',[
      z.object({action:z.literal('create'),input:z.unknown()}).strict(),
      z.object({action:z.literal('run'),id:z.uuid(),stage:z.enum(['discover','research','analyze','prepare','extract','resolve','verify','read-sites','verify-batch','review-saved','buyers','shortlist']),entityId:z.string().regex(/^E-[a-f0-9]{24}$/).optional(),alternativeSource:z.enum(['health','apollo','Google','Bing','read','verify']).optional(),targetPageUrl:z.string().url().max(1000).optional(),renderEmptyHtml:z.boolean().optional(),resolutionPlan:z.enum(['concise-v1','buyer-name-v2','buyer-alias-v2','buyer-market-v2','apollo-name-v1']).optional()}).strict(),
    ]).parse(JSON.parse(text));
    if(input.action==='create')return json({campaign:present(await withTenant(request,tenantId,(tx,c)=>createCampaign(tx,tenantId,c.userId,input.input),true))},201);
    const row=await withTenant(request,tenantId,tx=>claimCampaign(tx,input.id),true);
    const configured=providerConfig();
    const config={...configured,beforeSend:input.stage==='shortlist'?sharedBudgetGuard(request,tenantId,configured.alternativeScope||configured.shortlistScope,row.data.project.analysis?.id):undefined,alternativeSource:input.alternativeSource,targetEntityId:input.entityId,targetPageUrl:input.targetPageUrl,resolutionPlan:input.resolutionPlan,renderEmptyHtml:input.renderEmptyHtml,lookupRequest:(key:string)=>withTenant(request,tenantId,tx=>cachedRequest(tx,tenantId,key)),
      milestoneRows:(ids:string[])=>withTenant(request,tenantId,tx=>Promise.all(ids.map(id=>campaign(tx,id)))),
      entityExclusions:(ids:string[])=>withTenant(request,tenantId,async tx=>{
        const related=await Promise.all(ids.map(id=>campaign(tx,id)));
        return relatedExclusions('',[],related.flatMap(r=>r.data.companies));
      })};
    await executeSearch(row,input.stage,async(state,message)=>{await withTenant(request,tenantId,tx=>saveCampaign(tx,row,state,message),true);},config);
    const after=await withTenant(request,tenantId,tx=>campaigns(tx));
    return json({campaign:present(row,milestoneFor(row,after))});
  }catch(e){return failure(e);}
}
