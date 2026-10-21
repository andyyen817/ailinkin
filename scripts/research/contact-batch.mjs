import {hash} from './core.mjs';
import {recoverFoundingPeople} from './contact-founding-people.mjs';
import {platformCatalog} from './platform-catalog.mjs';
import {collectContactPool,contactPoolOptions} from './contact-source-pool.mjs';
import {appendDiscovery,discoveryCandidates,discoveryPermitted,staffQuery,discoveryVersion} from './contact-discovery.mjs';
function addStaffSearch(batch,unit,scope){
  if(!scope.publicDiscovery||unit.lookupKind==='person'||unit.lookupKind==='staff')return;
  const query=staffQuery(unit.companyName,unit.platform);
  if(!scope.allowedQueries.includes(query)||batch.units.some(u=>u.companyId===unit.companyId&&u.query===query))return;
  batch.units.push({id:'CU-'+hash(JSON.stringify([unit.companyId,unit.platform,query])).slice(0,24),companyId:unit.companyId,
    companyName:unit.companyName,platform:unit.platform,url:null,query,lookupKind:'staff',depth:0,state:'needs_search',reason:'补查本公司公开人员和岗位资料'});
}
/** @param {any} data @param {any} selection @param {string[]} platforms @param {any} accountsByCompany */
export function createContactBatch(data,selection,platforms,accountsByCompany={},now=Date.now(),preciseQueries=[]){
  if(!selection.confirmation?.valid||!selection.selected.length)throw Error('CONFIRMED_ENTERPRISE_SELECTION_REQUIRED');
  const selected=[...selection.selected].sort(),names=[...new Set(platforms)].sort(),units=[];
  for(const id of selected){const row=selection.rows.find(r=>r.id===id),company=data.companies.find(c=>c.id===row.companyId);
    for(const q of preciseQueries.filter(q=>q.companyId===company?.id&&q.priority===1&&q.personName&&q.evidence?.length&&names.includes(q.platform))){
      units.push({id:'CU-'+hash(JSON.stringify([id,q.platform,q.query])).slice(0,24),companyId:company.id,companyName:row.name,platform:q.platform,url:null,
        query:q.query,lookupKind:'person',personName:q.personName,targetRowId:q.rowId,evidence:q.evidence,state:'needs_search',reason:'根据已有姓名核对当前企业、任职日期与采购关系'});
    }
    for(const platform of names){
      const accounts=platform==='网页'&&company?.website?[{url:company.website,platform,ownership:'official_link'}]:(accountsByCompany[id]||[]).filter(a=>a.platform===platform);
      const list=accounts.length?accounts:[null];
      for(const account of list){const query=company?`"${company.name.replaceAll('"',' ')}"${platformCatalog[platform].domains[0]?' site:'+platformCatalog[platform].domains[0]:''}`:'';
        units.push({id:'CU-'+hash(JSON.stringify([id,platform,account?.url||query])).slice(0,24),companyId:company?.id||id,companyName:row.name,platform,url:account?.url||null,query,
          account,state:company?(account?'pending':'needs_search'):'needs_identity',reason:company?'':'候选尚未建立企业主体，需要先核实身份'});
      }
    }
  }
  const basis=hash(JSON.stringify([selection.confirmation.id,names,units.map(u=>[u.id,u.url,u.account?.evidence])])),id='CB-'+basis.slice(0,24);
  const previous=(data.contactBatches||[]).find(b=>b.id===id);if(previous)return {batch:previous,reused:true};
  if((data.contactBatches||[]).length>=100)throw Error('CONTACT_BATCH_HISTORY_LIMIT');
  const batch={id,basis,selectionId:selection.confirmation.id,selectionBasis:selection.basis,companyIds:selected,platforms:names,units,requests:[],createdAt:new Date(now).toISOString(),state:'prepared',sent:0};
  (data.contactBatches||=[]).push(batch);return {batch,reused:false};
}
export function batchUsage(data,batch){
  const requests=(data.contactResearchRuns||[]).filter(r=>r.batchId===batch.id).flatMap(r=>r.requests||[]);
  return {searchRequests:batch.requests.length,pageReads:requests.filter(r=>r.service==='social_public').length,modelRequests:requests.filter(r=>r.service==='ai').length,
    reservedUsd:[...requests,...batch.requests].reduce((n,r)=>n+(r.reservedCost||0),0),unknown:[...requests,...batch.requests].some(r=>['unknown','pending'].includes(r.status))};
}
/** @param {any} data @param {any} batch @param {any} selection @param {any} options */
export async function advanceContactBatch(data,batch,selection,{scope=null,executeUnit,executeCompany,searchAccounts,checkpoint,now=()=>Date.now(),cachedOnly=false}={}){
  if(!selection.confirmation?.valid||selection.confirmation.id!==batch.selectionId||selection.basis!==batch.selectionBasis)throw Error('CONTACT_BATCH_SELECTION_STALE');
  if(batch.units.some(u=>u.state==='running')||batchUsage(data,batch).unknown)throw Error('CONTACT_BATCH_UNKNOWN_REQUIRES_REVIEW');
  if(scope?.followUpQueries&&!batch.searchSourceFailure)for(const q of scope.followUpQueries){
    const company=data.companies.find(c=>c.id===q.companyId);
    if(!company||!batch.companyIds.includes(q.companyId)||!batch.platforms.includes(q.platform)||!scope.allowedQueries.includes(q.query))throw Error('CONTACT_FOLLOWUP_SELECTION_MISMATCH');
    if(batch.units.some(u=>u.companyId===q.companyId&&u.query===q.query))continue;
    if((data.contactBatches||[]).flatMap(b=>b.units).some(u=>u.companyId===q.companyId&&u.query===q.query&&['blocked','unknown'].includes(u.state)))throw Error('CONTACT_FOLLOWUP_PREVIOUS_FAILURE');
    batch.units.push({id:'CU-'+hash(JSON.stringify([q.companyId,q.platform,q.query])).slice(0,24),companyId:q.companyId,companyName:company.name,
      platform:q.platform,query:q.query,url:null,lookupKind:'approved_follow_up',state:'needs_search',depth:0,reason:'本轮明确批准的网页人物补查；原平台失败与次数保留'});
  }
  let reused=0;
  for(const unit of batch.units){if(!['pending','needs_search'].includes(unit.state))continue;
    const queryCache=(data.contactBatches||[]).flatMap(b=>b.units).findLast(u=>u!==unit&&u.companyId===unit.companyId&&u.query===unit.query&&u.searchResults&&Date.parse(u.searchExpiresAt)>now());
    if(unit.state==='needs_search'&&queryCache){Object.assign(unit,{searchResults:structuredClone(queryCache.searchResults),searchEvidenceIds:queryCache.searchEvidenceIds,searchExpiresAt:queryCache.searchExpiresAt,state:queryCache.lookupKind==='person'?'query_done':queryCache.searchResults.length?'pending':'not_found',account:queryCache.account,url:queryCache.url,reason:'已复用保存的精准查询'});reused++;}
    const saved=(data.contactResearchRuns||[]).findLast(r=>r.companyId===unit.companyId&&r.platform===unit.platform&&r.url===unit.url&&r.state==='done'&&Date.parse(r.expiresAt)>now());
    if(saved){unit.runId=saved.id;unit.state=saved.fallbackUsed?'cached_fallback':'cached';unit.reason=saved.fallbackUsed?'复用官网回退；此社媒入口仍受限':'已复用本批范围内保存结果';reused++;}
  }
  batch.sourcePools=batch.companyIds.flatMap(id=>{const c=data.companies.find(c=>c.id===id);if(!c)return [];const pool=collectContactPool(data,c,now(),contactPoolOptions(scope,id));return [{companyId:id,companyName:c.name,digest:pool.digest,...pool.coverage}];});
  batch.pendingCompanyAnalysis=batch.sourcePools.filter(p=>!(batch.poolResults||[]).some(r=>r.companyId===p.companyId&&r.digest===p.digest)).length;
  if(cachedOnly){await checkpoint();return {reused,externalRequests:0};}
  if(!scope||scope.batchId!==batch.id||scope.selectionId!==batch.selectionId||
    scope.tenantId!==data.project.tenantId||Date.parse(scope.expiresAt)<=now()||Date.parse(scope.approvedAt)>now())throw Error('CONTACT_BATCH_SCOPE_REQUIRED');
  if(Date.parse(scope.expiresAt)-Date.parse(scope.approvedAt)<=3600000)for(const failed of batch.units){
    const scopeId='CONTACT-'+hash(scope.id+batch.id+failed.id).slice(0,32).toUpperCase();
    if(failed.state!=='blocked'||failed.reason!=='CONTACT_SCOPE_EXPIRED'||failed.runId||!discoveryPermitted(scope,failed,batch)||
      (data.contactResearchRuns||[]).some(r=>r.scopeId===scopeId))continue;
    (failed.preflightHistory||=[]).push({reason:failed.reason,recoveredAt:new Date(now()).toISOString(),externalRequests:0});
    failed.state='pending';failed.reason='预检未发出请求；在原批准窗口内继续核实';
  }
  const linkedGroupRoot=u=>u.platform==='网页'&&scope.allowedUrls.includes(u.url)&&new URL(u.url).pathname==='/'&&u.url!==data.companies.find(c=>c.id===u.companyId)?.website;
  const policyVersion=discoveryVersion+':'+hash(JSON.stringify([scope.allowedUrls,scope.publicDiscovery]));
  if(scope.publicDiscovery)for(const prior of [...batch.units].sort((a,b)=>Number(linkedGroupRoot(b))-Number(linkedGroupRoot(a)))){
    if(prior.discoveryVersion===policyVersion)continue;const company=data.companies.find(c=>c.id===prior.companyId);
    if(prior.searchResults!==undefined){
      const hits=(data.contactSearchEvidence||[]).filter(s=>s.companyId===prior.companyId&&s.query===prior.query).map(s=>({url:s.sourceUrl,snippet:s.quote,title:s.title}));
      const accounts=discoveryCandidates(prior,hits,company);
      prior.discoveredPages=appendDiscovery(batch,prior,accounts,scope);prior.discoveryApplied=true;prior.discoveryVersion=policyVersion;addStaffSearch(batch,prior,scope);
    }else if(['cached','cached_fallback','done'].includes(prior.state)){
      const saved=data.contactResearchRuns.find(r=>r.id===prior.runId);
      if(saved&&!saved.fallbackUsed)prior.discoveredPages=appendDiscovery(batch,prior,discoveryCandidates(prior,saved.page?.links||[],company,true),scope);
      prior.discoveryApplied=true;prior.discoveryVersion=policyVersion;addStaffSearch(batch,prior,scope);
    }
  }
  const usage=batchUsage(data,batch);if(usage.reservedUsd>=scope.maxSpendUsd&&scope.maxModelRequests>0){batch.state='budget_reached';await checkpoint();return {reused,externalRequests:0};}
  const unit=scope.analysisOnly?null:batch.units.find(u=>u.state==='pending'&&scope.allowedUrls.includes(u.url))||batch.units.find(u=>u.state==='pending'&&u.platform==='网页')||
    batch.units.find(u=>u.state==='pending')||batch.units.find(u=>u.state==='needs_search');if(!unit){
    if(executeCompany){
      const company=data.companies.find(c=>batch.companyIds.includes(c.id)&&!(batch.poolResults||[]).some(r=>r.companyId===c.id&&r.digest===collectContactPool(data,c,now(),contactPoolOptions(scope,c.id)).digest));
      if(company){batch.state='analyzing_company';await checkpoint();
        const result=await executeCompany(company,scope);(batch.poolResults||=[]).push({companyId:company.id,companyName:company.name,state:result.state,digest:result.digest,
          coverage:result.coverage,runId:result.run?.id,people:result.run?.people?.length||0,unknowns:result.run?.unknowns||[],rejected:result.run?.extraction?.rejected?.length||0,reused:result.reused,finishedAt:new Date(now()).toISOString()});
        batch.state='partial';await checkpoint();return {reused,externalRequests:result.reused?0:1};
      }
    }
    batch.state=batch.units.some(u=>['blocked','needs_identity','not_found','outside_scope'].includes(u.state))?'partial':'complete_scope';await checkpoint();return {reused,externalRequests:0};
  }
  if(unit.state==='needs_search'){
    if(batch.searchSourceFailure){unit.state='blocked';unit.reason='搜索来源相关性或域名过滤未通过；停止新查询，保存缺项';batch.state='partial';await checkpoint();return {reused,externalRequests:0};}
    if(!scope.allowedQueries.includes(unit.query)||usage.searchRequests>=scope.maxSearchRequests){unit.state='outside_scope';unit.reason='缺账号查询额度或批准的精准查询，已保留缺项';batch.state='partial';await checkpoint();return {reused,externalRequests:0};}
    let found;
    try{found=await searchAccounts(unit,scope,batch);}catch(e){
      unit.state=batchUsage(data,batch).unknown?'unknown':'blocked';unit.reason=String(e.message||e);
      if(/INCLUSION_VIOLATION|EXCLUSION_VIOLATION|CONTACT_SEARCH_RELEVANCE_FAILED/.test(unit.reason))batch.searchSourceFailure=unit.reason;
      else if(unit.state!=='unknown')addStaffSearch(batch,unit,scope);batch.state=unit.state==='unknown'?'unknown':'partial';await checkpoint();return {reused,externalRequests:1};
    }
    unit.searchResults=found;unit.searchExpiresAt=new Date(now()+86400000).toISOString();
    if(scope.publicDiscovery){
      unit.state=found.length?'query_done':'not_found';unit.reason='查询片段已保存；观察到的页面将独立读取，不能视为任职证明';
      unit.discoveredPages=appendDiscovery(batch,unit,found,scope);unit.discoveryApplied=true;addStaffSearch(batch,unit,scope);
    }else if(unit.lookupKind==='person'){unit.state='query_done';unit.reason='查询结果已保存；姓名、任职及采购关系仍按出处核实';}
    else if(found.length){unit.account=found[0];unit.url=found[0].url;unit.state='pending';for(const a of found.slice(1))batch.units.push({...unit,id:'CU-'+hash(a.url).slice(0,24),url:a.url,account:a});}
    else{unit.state='not_found';unit.reason='本查询未发现可核实的账号；不代表没有人员';}
    await checkpoint();return {reused,externalRequests:1};
  }
  if(!discoveryPermitted(scope,unit,batch)||usage.pageReads>=scope.maxPageReads){unit.state='outside_scope';unit.reason='此页面不在本批批准范围或页面额度已用完';batch.state='partial';await checkpoint();return {reused,externalRequests:0};}
  unit.state='running';batch.state='running';await checkpoint();
  try{const result=await executeUnit(unit,scope,usage);unit.runId=result.run.id;
    unit.state=result.run.state==='done'?(result.run.fallbackUsed?'cached_fallback':'done'):result.run.state==='unknown'?'unknown':'blocked';unit.reason=result.run.reason||result.run.outcome?.label||'本页资料已保存，完整人员覆盖仍未知';
    if(scope.publicDiscovery&&!result.run.fallbackUsed&&result.run.page?.state==='read'){
      const company=data.companies.find(c=>c.id===unit.companyId);
      unit.discoveredPages=appendDiscovery(batch,unit,discoveryCandidates(unit,result.run.page.links||[],company,true),scope);
    }
    if(['blocked','cached_fallback'].includes(unit.state))addStaffSearch(batch,unit,scope);
  }catch(e){unit.state=batchUsage(data,batch).unknown?'unknown':'blocked';unit.reason=String(e.message||e);}
  batch.state=batchUsage(data,batch).unknown?'unknown':'partial';await checkpoint();return {reused,externalRequests:1};
}
export function recoverContactBatch(data,batch,now=Date.now()){
  if(batchUsage(data,batch).unknown){batch.state='unknown';throw Error('CONTACT_BATCH_UNKNOWN_REQUIRES_REVIEW');}
  for(const unit of batch.units.filter(u=>u.state==='running')){
    const saved=(data.contactResearchRuns||[]).findLast(r=>r.batchId===batch.id&&r.companyId===unit.companyId&&r.platform===unit.platform&&r.url===unit.url&&r.state==='done');
    if(saved){unit.runId=saved.id;unit.state=saved.fallbackUsed?'cached_fallback':'done';}
    else{unit.state='blocked';unit.reason='中断后没有可靠完成结果，不自动重复页面读取';}
  }
  recoverFoundingPeople(data,batch,now);
  batch.recoveredAt=new Date(now).toISOString();batch.state='partial';return batch;
}
