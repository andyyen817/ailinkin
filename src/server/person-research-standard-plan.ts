import 'server-only';
import type {Campaign} from '@/domain/research';import type {PersonBatch,PersonStep} from '@/domain/person-research';
import {personHash,personSelectionView} from './person-research-selection';
import {qualifiedSource,contactCapabilities} from './contact-source-policy';import {AccessError} from './policy';
import {personPageResult} from './person-research-public';
import {limitPersonFields} from './person-public-extraction';
import {companyDomain,finderEndpoints} from './contact-provider-finders';
import {ownershipQueries} from './free-email-ownership-scope';
export function standardPersonPlan(row:Campaign,scope:any,now=new Date().toISOString(),companyIds:string[]=[]):PersonBatch{
  const view=personSelectionView(row),selection=view.selection,steps:PersonStep[]=[];
  const followup=scope?.batchType==='free_contact_followup';
  const add=(personId:string,kind:PersonStep['kind'],input:any,state:PersonStep['state']='pending',result?:any)=>steps.push({id:'PST-'+personHash([personId,kind,input]).slice(0,24),personId,kind,input,state,...(result?{result}:{})});
  const people:any[]=[];
  if(companyIds.length){
    if(selection?.personIds.length)throw new AccessError('DISCOVERY_SEPARATE_FROM_SELECTED_PEOPLE',409);
    for(const id of [...new Set(companyIds)]){
      const c=row.data.companies.find((c:any)=>c.id===id);if(!c)throw new AccessError('COMPANY_NOT_IN_CAMPAIGN',400);
      const personId='company:'+id;people.push({personId,companyId:id,name:'企业人物发现',companyName:c.name,domain:c.domain||c.website,fields:[],missing:['姓名'],notice:'按企业域名发现人物；不限定采购岗位'});
      add(personId,'discover',{companyId:id,page:1,sourceId:qualifiedSource(scope,'apollo','/api/v1/mixed_people/api_search',['career'])?.id||'',fields:['career']});
    }
  }else{
    if(!view.valid||!selection?.personIds.length)throw new AccessError('PERSON_SELECTION_STALE_OR_EMPTY',409);
    for(const id of selection.personIds){
      const p=view.people.find(p=>p.personId===id)!,c=row.data.companies.find((c:any)=>c.id===p.companyId);
      const channels=p.personChannels||[],missing=selection.fields.filter(f=>f==='career'?!p.careerHistory?.length:f==='profile'?!p.profileUrl:f==='work_email'?!channels.some(ch=>ch.kind==='email'&&(ch as any).technical?.status==='valid'&&Date.parse((ch as any).technical.expiresAt)>Date.now()):!channels.some(ch=>['phone','whatsapp'].includes(ch.kind)));
      const knownUrls=[...new Set([p.profileUrl,...p.evidence.filter(e=>e.sourceType!=='search_snippet').map(e=>e.sourceUrl)].filter(Boolean))];
      const person:any={personId:id,rowId:p.id,basisHash:p.basisHash,companyId:p.companyId,name:p.name,companyName:p.companyName,domain:c?.domain||c?.website||'',profileUrl:p.profileUrl,
        providerId:(p.identityRefs||[]).find(v=>v.startsWith('apollo:'))?.slice(7),fields:selection.fields,missing,knownUrls,queries:[],state:missing.length?'pending':'reused',notice:'先复用资料，再按缺项及来源资格执行；未取得的字段保留未知',
        prospeoId:(p.identityRefs||[]).find(v=>v.startsWith('source:prospeo:'))?.slice(15),
        emailDomain:c?.emailDomain||'',emailDomainVerified:c?.emailDomainVerified===true};
      people.push(person);add(id,'reuse',{companyId:p.companyId},'done',{people:[],channels:[],notice:'已有证据和公开渠道已复用；不新增接口调用'});
      if(scope?.batchType==='new_contact_free'){
        if(selection.fields.join(',')!=='work_email'||!scope.people.some((v:any)=>v.personId===id&&v.companyId===p.companyId)||scope.excludedPersonIds.includes(id))throw new AccessError('NEW_CONTACT_EMAIL_ONLY_SCOPE',403);
        person.notice='只补查本批新人物工作邮箱；无结果记录原因并继续，旧人物及旧邮箱不再扣费。';
        const source=qualifiedSource(scope,'prospeo','/enrich-person',['work_email']);if(source&&person.prospeoId)add(id,'finder',{sourceId:source.id,provider:'prospeo',fields:['work_email']});
        continue;
      }
      if(scope?.batchType==='free_tomba'){
        if(selection.fields.join(',')!=='work_email')throw new AccessError('TOMBA_EMAIL_ONLY',400);
        person.notice='本轮只用批准的Tomba免费小批及新地址验证；同名主页冲突保留，暂不发信。';
        for(const call of scope.tombaCalls.filter((c:any)=>c.personId===id)){
          const source=qualifiedSource(scope,'tomba',call.endpoint,['work_email']);
          if(source)add(id,'finder',{provider:'tomba',endpoint:call.endpoint,sourceId:source.id,fields:['work_email'],...(call.endpoint==='/v1/domain-search'?{personIds:selection.personIds}:{})});
        }
        const source=qualifiedSource(scope,'public','page',['work_email']);if(source)for(const url of scope.publicUrls?.[id]||[])add(id,'page',{url,sourceId:source.id,fields:['work_email']});continue;
      }
      if(scope?.batchType==='free_contact_alternative'){
        if(selection.fields.join(',')!=='work_email')throw new AccessError('ALTERNATIVE_EMAIL_ONLY',400);
        person.notice='仅对批准的未查过人物使用Dropcontact免费积分；邮箱有效性及具名归属分别核实，不重复查询旧邮箱。';
        const source=qualifiedSource(scope,'dropcontact','/v1/enrich/all',['work_email']);
        if(source&&scope.dropcontactPersonIds.includes(id))add(id,'finder',{sourceId:source.id,provider:'dropcontact',fields:['work_email']});
        const page=qualifiedSource(scope,'public','page',['work_email']);
        if(page)for(const url of scope.publicUrls?.[id]||[])add(id,'page',{url,sourceId:page.id,fields:['work_email']});
        continue;
      }
      if(scope?.batchType==='free_email_ownership'){
        if(selection.fields.join(',')!=='work_email')throw new AccessError('EMAIL_OWNERSHIP_FIELDS_ONLY',400);
        person.notice='本轮只通过免费公开来源核对邮箱及人物归属；已有验证不重复调用，未查明继续保留未知';
        const source=qualifiedSource(scope,'langsearch','/v1/web-search',['work_email']);
        person.queries=ownershipQueries(scope,person);
        if(source)for(const query of person.queries)add(id,'search',{query,companyId:p.companyId,sourceId:source.id,fields:['work_email']});
        continue;
      }
      if(!missing.length)continue;
      if(/姓名不完整|未揭露|obfuscated/i.test(p.name)){person.notice='姓名不完整，保留候选；需完整姓名或可靠人员ID后补全';continue;}
      const hasEmail=channels.some(ch=>ch.kind==='email');
      const apiFields=missing.filter(f=>f==='career'||f==='profile'||f==='work_email'&&!hasEmail);
      const apollo=(scope?.sources||[]).find((s:any)=>s.fields?.some((f:string)=>apiFields.includes(f as any))&&qualifiedSource({...scope,sources:[s]},'apollo','/api/v1/people/match'));
      if(apollo)add(id,'apollo',{sourceId:apollo.id,fields:apiFields.filter(f=>apollo.fields.includes(f))});
      const finder=qualifiedSource(scope,'hunter','/v2/email-finder/found',['work_email']);if(missing.includes('work_email')&&!hasEmail&&finder&&person.emailDomainVerified)add(id,'finder',{sourceId:finder.id,fields:['work_email']});
      if(missing.includes('work_email')&&(!hasEmail||scope?.providerComparison===true)&&companyDomain(person.domain)){
        for(const [provider,endpoint] of Object.entries(finderEndpoints)){
          if(followup&&provider==='hunter'&&!scope.finderPersonIds.includes(id))continue;
          if(followup&&provider==='prospeo'&&p.companyId!==scope.prospeoCompanyId)continue;
          if(provider==='hunter'&&scope?.batchType==='known_profile_emails'&&p.companyId!==scope.fallbackCompanyId)continue;
          const source=qualifiedSource(scope,provider,endpoint,['work_email']);
          if(source)add(id,'finder',{sourceId:source.id,provider,fields:['work_email']});
        }
      }
      if(scope?.batchType==='known_profile_emails'||followup&&scope.stage==='enrich_after_reset')continue;
      const publicSource=qualifiedSource(scope,'public','page',missing);
      for(const url of (followup?[]:knownUrls.slice(0,2))){
        const cached=(row.data.personResearchBatches||[]).flatMap((b:any)=>b.steps.filter((s:any)=>s.kind==='page'&&s.state==='done'&&s.input.url===url&&b.people.some((v:any)=>v.personId===s.personId&&v.companyId===p.companyId))).find((s:any)=>s.result?.blocks?.length&&Date.parse(s.finishedAt||s.result.readAt||'')>Date.now()-30*86400000);
        add(id,'page',{url,companyId:p.companyId,sourceId:publicSource?.id||'',fields:missing},cached?'done':'pending',cached?{...limitPersonFields(personPageResult(person,cached.result),missing),reused:true,reusedFrom:cached.id}:undefined);
      }
      const search=qualifiedSource(scope,'langsearch','/v1/web-search',missing);
      if(search&&(!knownUrls.length||followup)){const query=`"${p.name.replaceAll('"','')}" "${p.companyName.replaceAll('"','')}"`;person.queries=[query];add(id,'search',{query,companyId:p.companyId,sourceId:search.id,fields:missing});}
      const verifier=qualifiedSource(scope,'hunter','/v2/email-verifier',['work_email']);if(verifier)for(const ch of channels.filter(ch=>ch.kind==='email'&&!ch.technical?.pending&&(!ch.technical?.expiresAt||Date.parse(ch.technical.expiresAt)<=Date.now())))add(id,'verify',{email:ch.value.toLowerCase(),sourceId:verifier.id,fields:['work_email']});
    }
  }
  const routeBasis=steps.map(s=>({personId:s.personId,kind:s.kind,input:s.input}));
  return {id:'PRB-'+personHash([row.id,companyIds.length?companyIds:selection?.id,'standard-v2',contactCapabilities(scope,row.tenant_id),routeBasis]).slice(0,32),selectionId:companyIds.length?'discovery':selection!.id,planVersion:2,state:'prepared',people,steps,
    usage:{searches:0,pages:0,network:0,images:0,models:0,usd:0,apollo:0,finder:0,verifications:0},createdAt:now,notice:'计划按缺项建立；来源未获准的步骤不会发送。现任、前任及未知关系分别保留。'};
}
