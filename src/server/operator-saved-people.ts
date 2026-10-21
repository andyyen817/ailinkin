import 'server-only';
import {createHash} from 'node:crypto';
import {contactReviewTable} from './contact-review-table';
import {companyDomain} from './contact-provider-finders';
const profile=(value:string)=>{try{const u=new URL(value);return u.hostname.replace(/^www\./,'').toLowerCase()+u.pathname.replace(/\/$/,'').toLowerCase();}catch{return '';}};
const name=(value:string)=>String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export function savedUnqueriedPeople(rows:any[],scope:any){
  const ids=new Set<string>(),urls=new Set<string>(),rowIds=new Set<string>(),names=new Set<string>();
  function exclude(person:any,campaignId:string){
    const id=person.sourcePersonId||(person.prospeoId?'prospeo:'+person.prospeoId:'');if(id)ids.add(id);
    if(profile(person.profileUrl))urls.add(profile(person.profileUrl));
    if(person.rowId)rowIds.add(campaignId+':'+person.rowId);if(person.personId)rowIds.add(campaignId+':'+person.personId);
    if(person.companyId&&person.name)names.add(person.companyId+':'+name(person.name));
  }
  for(const row of rows){
    for(const batch of row.data.personResearchBatches||[])for(const step of batch.steps||[])if(step.kind==='finder'){
      const p=batch.people?.find((p:any)=>p.personId===step.personId);if(p)exclude(p,row.id);
    }
    for(const batch of row.data.operatorBatches||[])for(const op of batch.receipts||[])if(op.kind==='finder'&&op.state!=='skipped'){
      const p=batch.people.find((p:any)=>p.personKey===op.personKey);if(p)exclude(p,row.id);
    }
  }
  const result:any[]=[],seenIds=new Set<string>(),seenUrls=new Set<string>();
  for(const row of rows)for(const p of contactReviewTable(row).rows){
    if(p.kind!=='person')continue;
    const t=scope.targets.find((t:any)=>t.campaignId===row.id&&t.companyId===p.companyId),source=p.identityRefs?.find((v:string)=>v.startsWith('source:prospeo:'))?.slice(7);
    if(!t||!source||ids.has(source)||urls.has(profile(p.profileUrl))||rowIds.has(row.id+':'+p.id)||rowIds.has(row.id+':'+p.personId)||names.has(p.companyId+':'+name(p.name))||seenIds.has(source)||profile(p.profileUrl)&&seenUrls.has(profile(p.profileUrl))||(p.personChannels||[]).some(c=>c.kind==='email'))continue;
    const company=row.data.companies.find((c:any)=>c.id===p.companyId);if(!company||companyDomain(company.website)!==t.domain)continue;
    const personKey=createHash('sha256').update(JSON.stringify([p.companyId,source])).digest('hex');
    if(scope.savedPersonKeys&&!scope.savedPersonKeys.includes(personKey))continue;
    seenIds.add(source);if(profile(p.profileUrl))seenUrls.add(profile(p.profileUrl));
    result.push({personKey,campaignId:row.id,companyId:p.companyId,companyName:p.companyName,name:p.name,profileUrl:p.profileUrl,domain:t.domain,sourcePersonId:source,prospeoId:source.slice(8),rowId:p.id,personId:p.personId,basisHash:p.basisHash,status:'未查询',reason:'已保存人物，尚无邮箱补查回执。'});
  }
  return result;
}
export function operatorReservedCredits(receipts:any[],provider:string){
  return receipts.filter(r=>r.provider===provider&&r.kind!=='account'&&r.state!=='skipped').reduce((sum:number,r:any)=>{
    if(r.reusedFrom&&r.state==='done')return sum;
    if(provider==='hunter')return sum+0.5;
    const raw=r.result?.observation;
    const provenFree=r.kind==='finder'&&r.state==='done'&&(raw?.error===true&&raw.error_code==='NO_MATCH'&&raw.httpStatus===400||raw?.error===false&&raw.free_enrichment===true);
    return sum+(provenFree?0:1);
  },0);
}
export function savedOperatorDaily(rows:any[],at=Date.now()){
  const receipts=rows.flatMap(r=>(r.data.operatorBatches||[]).flatMap((b:any)=>b.receipts||[])).filter(r=>r.kind==='finder'&&r.provider==='prospeo'&&r.finishedAt).sort((a,b)=>Date.parse(b.finishedAt)-Date.parse(a.finishedAt));
  for(const r of receipts){
    const headers=r.stages.findLast((s:any)=>s.rateHeaders)?.rateHeaders;if(!headers)continue;
    const remaining=Number(headers['x-daily-request-left']),seconds=Number(headers['x-daily-reset-seconds']),until=Date.parse(r.finishedAt)+seconds*1000;
    if(Number.isInteger(remaining)&&remaining>=0&&Number.isFinite(seconds)&&seconds>0&&until>at)return {remaining,until:new Date(until).toISOString(),checkedAt:r.finishedAt};
  }
  return null;
}
