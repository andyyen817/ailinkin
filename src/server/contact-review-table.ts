import 'server-only';
import {createHash} from 'node:crypto';
import type {Campaign} from '@/domain/research';
import type {ReviewRow,ReviewTable,ReviewEvidence} from '@/domain/contact-review';
import {deepContactCoverage} from '../../scripts/research/contact-coverage.mjs';
import {contactSourceAdmission,differentEmployerNames,observedEmployerName} from '../../scripts/research/contact-source-relevance.mjs';
import {contactCareerClaims} from '../../scripts/research/contact-career.mjs';
import {identityRefs,resolvePersonIdentity,personOwner} from './person-identity';
import {companyContactEntries,publicAccountUrl} from './company-contact-entries';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const norm=(v:unknown)=>String(v??'').normalize('NFKC').trim();
export function mergeContactChecks(old:any={},next:any={}){
  const defined=Object.fromEntries(Object.entries(next).filter(([,v])=>v!==undefined));
  const a=old.technical,b=next.technical;
  const technical=b&&(!a||['invalid','disposable'].includes(b.status)||!a.verifiedAt||b.verifiedAt&&Date.parse(b.verifiedAt)>=Date.parse(a.verifiedAt))?b:a;
  const history=[...(old.technicalHistory||[]),a,b].filter(Boolean);
  return {...old,...defined,...(technical?{technical,technicalHistory:[...new Map(history.map(v=>[JSON.stringify(v),v])).values()]}:{})};
}
function evidence(value:any):ReviewEvidence[]{
  const list=value.evidence|| (value.sourceUrl?[{sourceUrl:value.sourceUrl,quote:value.quote||value.label||'',retrievedAt:value.retrievedAt,contentHash:value.contentHash}]:[]);
  return list.filter((e:any)=>/^https?:\/\//.test(e.sourceUrl||'')).map((e:any)=>({sourceUrl:e.sourceUrl,quote:e.quote||'',retrievedAt:e.retrievedAt,contentHash:e.contentHash,...(e.publishedAt?{publishedAt:e.publishedAt}:{}),...(['search_snippet','social_body','website_body','provider_receipt'].includes(e.sourceType)?{sourceType:e.sourceType}:{})}));
}
export function contactReviewTable(row:Campaign):ReviewTable{
  const rows=new Map<string,ReviewRow>(),companies=row.data.companies||[],coverage=new Map<string,ReviewTable['coverage'][number]>();
  const empty={basisHash:'',title:'',relationship:'unknown',scope:'',channelKind:'',value:'',email:'',phone:'',profileUrl:'',employerVerified:false,
    purchaseAuthority:'unknown',verification:'unknown',doNotContact:false,crmContactId:'',platforms:[] as string[]};
  function put(key:string,v:Omit<ReviewRow,'id'|'basisHash'>){
    const existing=v.kind==='person'&&v.profileUrl?[...rows.values()].find(r=>r.kind==='person'&&r.companyId===v.companyId&&r.profileUrl===v.profileUrl&&norm(r.name).toLowerCase()===norm(v.name).toLowerCase()):undefined;
    const id=existing?.id||'RV-'+hash(key).slice(0,32),old=rows.get(id);if(old){
      old.evidence=[...new Map([...old.evidence,...v.evidence].map(e=>[JSON.stringify(e),e])).values()];old.platforms=[...new Set([...old.platforms,...v.platforms])];
      old.crmContactId||=v.crmContactId;old.doNotContact||=v.doNotContact;
      if(v.identityRefs?.length)old.identityRefs=[...new Set([...(old.identityRefs||[]),...v.identityRefs])];
      if(!old.title&&v.title)old.title=v.title;
      if(v.employerClaim){if(old.employerClaim&&old.employerClaim!==v.employerClaim)(old.detailUnknowns||=[]).push('不同来源的任职企业名称冲突，日期与主体待核实');else old.employerClaim=v.employerClaim;}
      if(v.employmentDates?.length)old.employmentDates=[...new Set([...(old.employmentDates||[]),...v.employmentDates])];
      if(v.careerHistory?.length)old.careerHistory=[...new Map([...(old.careerHistory||[]),...v.careerHistory].map(c=>[JSON.stringify(c),c])).values()];
      if(v.careerUnknowns?.length)old.careerUnknowns=[...new Set([...(old.careerUnknowns||[]),...v.careerUnknowns])];
      if(v.detailUnknowns?.length)old.detailUnknowns=[...new Set([...(old.detailUnknowns||[]),...v.detailUnknowns])];
      if(v.affiliationStatus==='employer_name_differs')old.affiliationStatus=v.affiliationStatus;
      if(v.rejectedRelationship==='founder'){old.relationship='mentioned';old.rejectedRelationship=v.rejectedRelationship;}
      if(v.checks)old.checks=mergeContactChecks(old.checks,v.checks);
    }else rows.set(id,{...v,id,basisHash:''});
  }
  function channel(c:any,companyId:string,companyName:string,platform:string){
    const kind=c.kind||'',value=kind==='social'?publicAccountUrl(c.value):norm(c.value),ev=evidence(c);if(!value||!ev.length)return;
    const publicRoute=companies.find((v:any)=>v.id===companyId)?.contactPackage?.routes?.find((v:any)=>v.kind===kind&&norm(v.value).toLowerCase()===value.toLowerCase()&&['company','store'].includes(v.scope));
    const scope=c.scope==='person'&&publicRoute?publicRoute.scope:c.scope||'company';
    put(JSON.stringify([companyId,'channel',scope,scope==='person'?c.personId||'':'',kind,kind==='email'?value.toLowerCase():value]),{
      ...empty,companyId,companyName,kind:'channel',name:scope==='person'?(c.personId||'个人渠道'):'',scope,channelKind:kind,value,
      ...(scope==='person'?{ownerRef:c.ownerRef||c.personId||''}:{}),
      email:kind==='email'?value:'',phone:['phone','whatsapp'].includes(kind)?value:'',verification:c.verification||'unverified',
      ...((c.ownership||c.technical||c.provenance)?{checks:{ownership:c.ownership,provenance:c.provenance,channelEmployer:c.channelEmployer,targetEmployer:c.targetEmployer,providerId:c.providerId,observedAt:c.observedAt,technical:c.technical}}:{}),
      doNotContact:!!c.doNotContact,evidence:ev,platforms:[platform]});
  }
  for(const plan of row.data.contactResearchPlans||[])for(const c of plan.companies||[]){
    for(const ch of c.channels||[])channel(ch,c.companyId,c.name,'网页');
    for(const s of c.platformStates||[])coverage.set(c.companyId+':'+s.platform,{companyId:c.companyId,companyName:c.name,platform:s.platform,
      state:s.platform==='网页'?'saved_partial':'pending',notice:s.notice||'尚未完成公开资料研究'});
  }
  for(const c of companies)for(const ch of c.contactPackage?.routes||[])channel(ch,c.id,c.name,'网页');
  for(const c of companies)for(const ch of companyContactEntries(row.data,c))channel(ch,c.id,c.name,ch.platform);
  for(const c of companies)for(const p of c.contactCandidates?.people||[]){
    if(!p.evidence?.length)continue;
    put(JSON.stringify([c.id,'person','apollo:'+p.providerId]),{...empty,companyId:c.id,companyName:c.name,kind:'person',
      name:p.name+(p.nameMasked?'（姓氏未揭露）':''),title:p.title||'',relationship:'unknown',employerVerified:false,purchaseAuthority:'unknown',
      identityRefs:identityRefs(p),
      evidence:evidence(p),verification:'provider_candidate_unverified',platforms:['Apollo']});
  }
  for(const run of row.data.contactResearchRuns||[]){
    const name=run.companyName||companies.find((c:any)=>c.id===run.companyId)?.name||'',platform=run.page?.method==='saved_official_website'?'网页':run.platform;
    for(const p of run.people||[]){put(JSON.stringify([run.companyId,'person',p.sourcePersonId||p.profileUrl||norm(p.name).toLowerCase()]),{
      ...empty,companyId:run.companyId,companyName:name,kind:'person',name:p.name,title:p.title||'',relationship:p.relationship||'unknown',
      employerVerified:!!p.employerVerified,purchaseAuthority:p.purchaseAuthority||'unknown',profileUrl:p.profileUrl||'',
      identityRefs:identityRefs(p),
      ...(p.employerClaim||p.employmentDates?.length||p.detailUnknowns?.length?{employerClaim:p.employerClaim||'',employmentDates:[...(p.employmentDates||[])],detailUnknowns:[...(p.detailUnknowns||[])]}:{}),
      ...(p.affiliationStatus==='employer_name_differs'?{affiliationStatus:p.affiliationStatus}:{}),
      ...(p.rejectedRelationship?{rejectedRelationship:p.rejectedRelationship}:{}),
      ...(p.careerHistory?.length?{careerHistory:p.careerHistory.map((j:any)=>({...j,evidence:evidence(j)}))}:{}),
      ...(p.careerUnknowns?.length?{careerUnknowns:[...p.careerUnknowns]}:{}),
      evidence:evidence(p),crmContactId:p.crmContactId||'',platforms:[...(run.sourcePlatforms||[platform])]});
      for(const ch of p.contacts||[])channel({...ch,personId:p.name,ownerRef:p.personId||identityRefs(p)[0]||p.name},run.companyId,name,platform);
    }
    for(const ch of run.channels||[])channel(ch,run.companyId,name,platform);
    if(run.page?.method==='company_source_pool')continue;
    if(run.page?.method==='anonymous_public_browser'){for(const c of run.page.coverageRows||[])coverage.set(run.companyId+':'+c.platform,{companyId:run.companyId,companyName:name,platform:c.platform,state:c.state,notice:c.notice||'本批公开入口状态'});continue;}
    const failures=run.sourceFailures||[];
    coverage.set(run.companyId+':'+run.platform,{companyId:run.companyId,companyName:name,platform:run.platform,
      state:failures.length||platform!==run.platform?'blocked':run.state==='done'?'read_partial':'pending',
      notice:failures.length||platform!==run.platform?'公开入口受限；已保留限制记录，官网资料不能代表社媒正文':'仅代表本次已读取页面'});
  }
  for(const job of row.data.browserContactJobs||[])if(job.page?.method==='anonymous_public_browser')for(const c of job.page.coverageRows||[])
    coverage.set(job.companyId+':'+c.platform,{companyId:job.companyId,companyName:job.companyName,platform:c.platform,state:c.state,notice:c.notice||'本批免登录来源状态，未取得不代表无人'});
  for(const p of row.data.contacts||[]){
    const c=companies.find((c:any)=>c.id===p.companyId);if(!c||!evidence(p).length)continue;
    put(JSON.stringify([c.id,'person',p.sourcePersonId||p.providerId||p.profileUrl||norm(p.name).toLowerCase()]),{
      ...empty,companyId:c.id,companyName:c.name,kind:'person',name:p.name,title:p.title||'',relationship:p.relationship||'unknown',
      employerVerified:!!p.employerVerified,purchaseAuthority:p.purchaseAuthority||'unknown',profileUrl:p.profileUrl||'',
      identityRefs:identityRefs(p),
      doNotContact:!!p.doNotContact,evidence:evidence(p),crmContactId:p.crmContactId||'',platforms:['已有联系人']});
    if(p.email)channel({kind:'email',scope:'person',personId:p.sourcePersonId||p.providerId||p.name,ownerRef:identityRefs(p)[0]||p.name,value:p.email,evidence:p.evidence,
      verification:p.emailStatus,doNotContact:p.doNotContact},c.id,c.name,'已有联系人');
  }
  for(const s of row.data.contactSearchEvidence||[]){
    const company=companies.find((c:any)=>c.id===s.companyId);
    if(!s.identityMatch||!s.personName||!company)continue;
    const ev=evidence(s),old=rows.get(s.targetRowId);if(!ev.length)continue;
    if(old&&old.companyId===s.companyId&&old.name===s.personName){old.evidence=[...new Map([...old.evidence,...ev].map(e=>[JSON.stringify(e),e])).values()];old.platforms=[...new Set([...old.platforms,s.platform])];}
    else put(JSON.stringify([s.companyId,'person',norm(s.personName).toLowerCase()]),{...empty,companyId:s.companyId,companyName:s.companyName,kind:'person',name:s.personName,evidence:ev,platforms:[s.platform]});
  }
  const latest=row.data.contactBatches?.at(-1);if(latest)for(const c of deepContactCoverage(row.data,latest))coverage.set(c.companyId+':'+c.platform,c);
  const list=[...rows.values()].sort((a,b)=>a.id.localeCompare(b.id));
  for(const r of list)if(r.kind==='person')r.personId=resolvePersonIdentity(row.id,r,row.data.personIdentities||[]).id;
  for(const r of list)if(r.kind==='channel'&&r.scope==='person'){
    const owner=personOwner(list,r.companyId,r.ownerRef||r.name);if(owner)r.ownerPersonId=owner.personId;
  }
  for(const r of list){
    let admissionState='';
    if(r.kind==='person'){
      const c=companies.find((c:any)=>c.id===r.companyId),checks=r.evidence.map(e=>contactSourceAdmission(c||{name:r.companyName},e,{differentEmployers:differentEmployerNames(row.data,c||{id:r.companyId})}));
      const held=!checks.some(a=>a.state==='admitted');
      admissionState=held?'held':'association_needs_review';
      if(held){r.employerVerified=false;r.purchaseAuthority='unknown';}
    }
    r.evidence.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));r.platforms.sort();
    const legacy:any={...r,basisHash:'',crmContactId:''};
    for(const key of ['personId','identityRefs','ownerPersonId','ownerRef','legacyBasisHash'])delete legacy[key];
    r.legacyBasisHash=hash(legacy);
    if(admissionState){r.admissionState=admissionState;
      if(admissionState==='held')r.detailUnknowns=[...new Set([...(r.detailUnknowns||[]),'关联依据尚不完整；保留人物提及和联系路径，交给销售判断。'])];
      if(!r.careerHistory?.length)r.careerHistory=contactCareerClaims({name:r.name,employer:observedEmployerName(r),title:r.title,employmentDates:r.employmentDates,relationship:r.relationship},r.evidence).careerHistory;
      r.personChannels=list.filter(ch=>ch.kind==='channel'&&ch.scope==='person'&&ch.companyId===r.companyId&&ch.ownerPersonId===r.personId).map(ch=>({kind:ch.channelKind,value:ch.value,scope:ch.scope,evidence:ch.evidence,...ch.checks}));
      if(list.some(p=>p.id!==r.id&&p.kind==='person'&&p.companyId===r.companyId&&norm(p.name).toLowerCase()===norm(r.name).toLowerCase()))r.detailUnknowns=[...(r.detailUnknowns||[]),'存在同名人物记录；缺少共同个人资料链接，未擅自合并。'];}
    r.basisHash=hash({...r,basisHash:'',crmContactId:'',legacyBasisHash:''});
  }
  return {rows:list,tableHash:hash(list.map(r=>[r.id,r.basisHash])),coverage:[...coverage.values()],tableReady:list.length>0,collectionComplete:false};
}
