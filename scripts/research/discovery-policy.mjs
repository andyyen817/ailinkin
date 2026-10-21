export function executionLimit(data){return data.project.discoveryPolicy?.mode==='coverage'?data.project.discoveryPolicy.maxOrganizations:data.project.target;}
export function coverageQueryOrder(data,queryFor=value=>value){
  if(data.project.discoveryPolicy?.mode!=='coverage')return data.project.keywords;
  const policy=data.project.discoveryPolicy,rows=data.project.keywords.map(keyword=>{
    const query=queryFor(keyword),batches=data.batches.filter(b=>b.keyword===keyword||b.query===query),last=batches.at(-1);
    const completed=batches.filter(b=>b.status==='已完成'),tail=completed.slice(-policy.lowYieldRounds);
    const blocked=last&&(/待核实|访问受限/.test(last.status)||/EXCLUSION_VIOLATION/.test(last.error||''));
    const lowYield=tail.length===policy.lowYieldRounds&&tail.every(b=>(b.added||0)<=policy.minNewPerRound&&b.qualityChecked===true);
    const reviewRequired=!!last&&last.status==='已完成'&&(last.added||0)<=policy.minNewPerRound&&!last.qualityChecked;
    return {keyword,query,batches:batches.length,status:blocked?'source_blocked':lowYield?'low_yield':reviewRequired?'needs_source_review':'available',
      added:last?.added||0,duplicates:last?.duplicates||0};
  });
  const open=rows.filter(r=>r.status==='available').sort((a,b)=>a.batches-b.batches||b.added-a.added);
  data.discoveryCoverage={mode:'coverage',expectedTarget:policy.expectedTarget,groups:rows,attemptedGroups:rows.filter(r=>r.batches).length,totalGroups:rows.length,
    marketExhausted:false,stopReason:open.length?null:rows.some(r=>r.status==='source_blocked')?'来源受限，保留未覆盖范围；需处理来源':rows.some(r=>r.status==='needs_source_review')?'新增量偏低，先核实查询和来源，不代表市场已搜尽':'当前查询组暂时低新增，可选择扩展范围或其他来源'};
  return open.map(r=>r.keyword);
}
export function discoveryStop(data){
  if(data.project.discoveryPolicy?.mode!=='coverage')return null;
  const spent=data.requests.reduce((n,r)=>n+(r.reservedCost||0),0);
  if(data.requests.some(r=>['pending','unknown'].includes(r.status)))return '存在结果未知的请求，核对前不重复调用';
  if(data.requests.length>=data.project.maxRequests||spent>=data.project.maxSpendUsd&&data.project.maxSpendUsd>0)return '本批预算已用完；资料及未覆盖范围已保留';
  if(data.companies.filter(c=>!c.sourceOnly).length>=executionLimit(data))return '已达到单任务处理容量；保留资料与剩余范围';
  return data.discoveryCoverage?.stopReason||null;
}
