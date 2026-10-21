import 'server-only';
import type {Campaign} from '@/domain/research';import type {PersonBatch} from '@/domain/person-research';import {personHash} from './person-research-selection';
import {contactReviewTable} from './contact-review-table';
import {identityRefs} from './person-identity';
const normal=(v:string)=>String(v||'').normalize('NFKC').trim().toLowerCase();
function legacySeed(row:Campaign,p:any){
  const matches=(seed:string)=>'RV-'+personHash(JSON.stringify([p.companyId,'person',seed])).slice(0,32)===p.rowId;
  for(const run of row.data.contactResearchRuns||[])if(run.companyId===p.companyId)for(const raw of run.people||[]){const seed=raw.sourcePersonId||raw.profileUrl||normal(raw.name);if(matches(seed))return seed;}
  for(const raw of row.data.contacts||[])if(raw.companyId===p.companyId){const seed=raw.sourcePersonId||raw.providerId||raw.profileUrl||normal(raw.name);if(matches(seed))return seed;}
  const candidates=row.data.companies.find((c:any)=>c.id===p.companyId)?.contactCandidates?.people||[];
  for(const raw of candidates)if(matches('apollo:'+raw.providerId))return 'apollo:'+raw.providerId;
  if(matches(normal(p.name)))return normal(p.name);throw Error('PERSON_LEGACY_REFERENCE_UNRESOLVED');
}
export function applyPersonResearchResults(row:Campaign,batch:PersonBatch){
  let changed=false;const runs=row.data.contactResearchRuns||=[];
  for(const step of batch.steps.filter(s=>s.state==='done'&&['model','apollo','page','finder','discover','verify'].includes(s.kind))){
    const id='PRR-'+personHash([batch.id,step.id,step.result?.extractionKey||step.result?.sourceDigest||step.result]).slice(0,32);
    if(runs.some((r:any)=>r.id===id))continue;
    const selected=batch.people.filter(p=>p.personId===step.personId||step.input.personIds?.includes(p.personId));
    if(step.kind==='verify'){
      const seeds=selected.map(p=>legacySeed(row,p));
      for(const run of runs)if(run.companyId===selected[0]?.companyId)for(const p of run.people||[])if(selected.some(s=>s.personId===p.personId)||seeds.includes(p.sourcePersonId||normal(p.name)))for(const c of p.contacts||[])if(c.kind==='email'&&c.value.toLowerCase()===step.input.email.toLowerCase())c.technical=step.result.technical;
    }
    const people=(step.result?.people||[]).flatMap((found:any)=>{
      if(step.kind==='discover')return [{...found,sourcePersonId:'apollo:'+found.providerId,name:found.name+(found.nameMasked?'（姓名不完整）':''),detailUnknowns:found.nameMasked?['姓名被遮挡，不能用于完整姓名补全']:[]}];
      const matches=selected.filter(p=>normal(p.name)===normal(found.name));if(matches.length!==1)return [];
      const p=matches[0],candidates=contactReviewTable(row).rows.filter(r=>r.kind==='person'&&r.companyId===p.companyId&&normal(r.name)===normal(p.name));
      const target=candidates.find(r=>r.personId===p.personId),refs=identityRefs(found);
      if(!target||candidates.length>1&&!target.identityRefs?.some(ref=>/^(url:|source:prospeo:)/.test(ref)&&refs.includes(ref)))return [];
      const seed=legacySeed(row,p),evidence=(found.evidence||[]).map((e:any)=>({...e}));
      return [{name:p.name,sourcePersonId:seed,personId:p.personId,providerId:found.providerId,title:found.title||'',profileUrl:found.profileUrl||'',
        relationship:found.relationship||'unknown',employerVerified:false,employerClaim:found.employerClaim||'',
        careerHistory:found.careerHistory||[],careerUnknowns:found.careerUnknowns||[],employmentDates:found.employmentDates||[],
        detailUnknowns:found.detailUnknowns||[],contacts:found.contacts||[],evidence}];
    });
    const companyId=selected[0]?.companyId;if(!companyId)continue;
    runs.push({id,batchId:batch.id,companyId,companyName:selected[0].companyName,platform:['apollo','discover'].includes(step.kind)?'Apollo':step.kind==='finder'?step.result?.provider||'Hunter':'公开人物资料',
      state:'done',people,channels:step.result?.channels||[],page:{method:'company_source_pool'},sourceFailures:[],retrievedAt:step.finishedAt});
    if(step.result?.extractionKey)(row.data.personResearchExtractions||=[]).push(step.result);
    const audit=row.data.personResearchResults||=[];audit.push({id,batchId:batch.id,stepId:step.id,personIds:selected.map(p=>p.personId),people:people.length,
      channels:(step.result?.channels||[]).length,notice:step.result?.notice||'公开人物资料已保存，待销售判断',observations:step.result?.otherPeople||[]});
    changed=true;
  }
  if(changed&&row.data.contactMailHandoff)row.data.contactMailHandoff.superseded=true;
  return {changed,sent:0};
}
export function personResearchStatus(row:Campaign,personId?:string){
  const batch=(row.data.personResearchBatches||[]).findLast((b:PersonBatch)=>b.people.some(p=>p.personId===personId));
  if(!batch)return '';
  const labels:Record<string,string>={prepared:'已保存计划，未启动',queued:'后台排队',running:'补查中',paused:'已暂停',blocked:'已停止，请查看原因',done:'本批来源已处理；未取得字段仍为未知'};
  return labels[batch.state]||'补查状态待核实';
}
