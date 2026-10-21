import 'server-only';
import type {Campaign} from '@/domain/research';
import {readContactImage} from './contact-evidence-store';
import {transport} from '../../scripts/research/http.mjs';
import {contactVision} from '../../scripts/research/contact-vision.mjs';
export function browserModelBudget(data:any,scope:any){
  const requests=(data.contactResearchRuns||[]).filter((r:any)=>r.batchId===scope.priorBatchId||r.scopeId===scope.id).flatMap((r:any)=>r.requests||[]).filter((r:any)=>r.service==='ai');
  if(requests.some((r:any)=>['pending','unknown'].includes(r.status)))throw Error('BROWSER_MODEL_UNKNOWN_NO_REPLAY');
  const own=(data.contactResearchRuns||[]).filter((r:any)=>r.scopeId===scope.id).flatMap((r:any)=>r.requests||[]).filter((r:any)=>r.service==='ai');
  const cents=(items:any[])=>items.reduce((n:number,r:any)=>n+Math.round((r.reservedCost||0)*100),0);
  if(own.length>=scope.maxModelRequests||requests.length>=scope.modelTotalLimit||cents(own)+5>Math.round(scope.maxSpendUsd*100)||cents(requests)+5>Math.round(scope.modelTotalBudget*100))throw Error('BROWSER_MODEL_BUDGET_REACHED');
  return {priorRequests:requests.length,priorReservedUsd:requests.reduce((n:number,r:any)=>n+(r.reservedCost||0),0)};
}
export async function analyzeBrowserCollection(row:Campaign,job:any,scope:any,checkpoint:()=>Promise<unknown>,budgetData:any=row.data){
  const anonymous=job.page?.method==='anonymous_public_browser';
  if(!job.fresh||!['visible_social_browser','anonymous_public_browser'].includes(job.page?.method)||(!job.images?.length&&!anonymous))throw Error('FRESH_SOCIAL_SCREENSHOT_REQUIRED');
  if(anonymous&&!(job.page?.blocks?.length||job.images?.length))throw Error('FRESH_PUBLIC_CONTENT_REQUIRED');
  if(Date.parse(scope.expiresAt)<=Date.now())throw Error('BROWSER_SCOPE_EXPIRED');
  if(!process.env.DEEPSEEK_API_KEY)throw Error('BROWSER_MODEL_KEY_MISSING');
  const budget=browserModelBudget(budgetData,scope),company=row.data.companies.find((c:any)=>c.id===job.companyId),run=row.data.contactResearchRuns.find((r:any)=>r.id===job.runId);
  if(!company||!run||run.scopeId!==scope.id||run.requests.length)throw Error('BROWSER_MODEL_ALREADY_ATTEMPTED');
  run.batchId=scope.priorBatchId;job.analysisAttempted=true;job.analysisBudgetBefore=budget;await checkpoint();
  const call=transport({requests:run.requests,project:{maxRequests:1,maxSpendUsd:.05}},{keys:{DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY},live:true,costUpperBound:{ai:.05},cacheSeconds:{ai:86400}},checkpoint);
  // The initial real pilot tests actual image reading; raw DOM remains saved separately.
  const material=anonymous?run.page.blocks||[]:[];
  run.extraction=await contactVision(call,{company,blocks:material,images:run.images,loadImage:(id:string)=>readContactImage(row.tenant_id,id)});call.commit();
  if(anonymous)for(const person of run.extraction.people)person.evidence=person.evidence.map((e:any)=>({...e,sourceType:'social_body'}));
  const savedPeople=run.people||[];
  for(const p of run.extraction.people){const old=savedPeople.find((v:any)=>v.name===p.name&&(!v.profileUrl||!p.profileUrl||v.profileUrl===p.profileUrl));
    if(old){p.sourcePersonId=old.sourcePersonId||p.sourcePersonId;p.contacts=[...(old.contacts||[]),...(p.contacts||[])];}}
  run.people=[...savedPeople.filter((p:any)=>!run.extraction.people.some((v:any)=>v.sourcePersonId===p.sourcePersonId)),...run.extraction.people];
  run.unknowns=run.extraction.unknowns;run.channels=[...run.channels,...run.people.flatMap((p:any)=>p.contacts||[])];
  run.finishedAt=new Date().toISOString();job.analysisState='done';job.state='needs_visual_review';job.people=run.people.length;job.modelImages=run.images.length;job.imageQuotesNeedReview=true;await checkpoint();
}
