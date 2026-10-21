export function diagnoseContactFailure(error){
  const text=String(error?.message||error||''),status=error?.httpStatus||error?.statusCode;
  if(/UNKNOWN|结果未知|是否受理未知|网络中断|CHECKPOINT_CONFLICT/i.test(text))return {kind:'unknown_result',repeat:false,next:'inspect_request',humanNeeded:true};
  if(status===429||/限流|rate.limit|HTTP 429/i.test(text))return {kind:'rate_limited',repeat:false,next:'reuse_saved_evidence',retryAt:error?.retryAt||null,humanNeeded:false};
  if(/robots|禁止读取/i.test(text))return {kind:'robots_denied',repeat:false,next:'reuse_saved_evidence',humanNeeded:false};
  if(/captcha|验证码|验证|challenge|log.?in|sign.?in|登录|登入|拒绝访问/i.test(text))return {kind:'platform_barrier',repeat:false,next:'reuse_saved_evidence',humanNeeded:false};
  if(/BUDGET|SCOPE|额度|费用上限/i.test(text))return {kind:'budget_or_scope',repeat:false,next:'show_remaining_requirements',humanNeeded:true};
  if(/JSON|QUOTE|FIELD|截断|空正文/i.test(text))return {kind:'extraction_quality',repeat:false,next:'recheck_saved_response',humanNeeded:false};
  if(/ENOTFOUND|ECONN|ETIMEDOUT|读取超时|网络|HTTP [45]\d\d/i.test(text))return {kind:'source_unavailable',repeat:false,next:'reuse_saved_evidence',humanNeeded:false};
  return {kind:'unclassified',repeat:false,next:'reuse_saved_evidence',humanNeeded:false};
}
/** @param {{diagnosis:any,savedPages?:number,modelAvailable?:boolean,remainingReads?:number,allowedSources?:string[]}} input */
export function recoveryActions({diagnosis,savedPages=0,modelAvailable=false,remainingReads=0,allowedSources=[]}){
  const actions=[];
  if(diagnosis.kind==='unknown_result')actions.push({action:'inspect_request',state:'requires_review',reason:'核对结果，保留请求和费用；不重新发送。'});
  if(savedPages>0)actions.push({action:'reuse_saved_evidence',state:'automatic',reason:'复用同企业已核实官网证据，不增加网页请求。'});
  if(modelAvailable&&savedPages>0&&diagnosis.kind!=='unknown_result')actions.push({action:'extract_saved_evidence',state:'automatic',reason:'在剩余模型次数和费用内整理可靠材料。'});
  for(const source of allowedSources)actions.push({action:'switch_allowed_source',source,state:remainingReads>0&&diagnosis.kind!=='unknown_result'?'automatic':'requires_scope',reason:'新读取必须仍在本次来源及页数范围内。'});
  if(!actions.some(a=>a.state==='automatic'))actions.push({action:'show_remaining_requirements',state:'needs_information',reason:'保存已完成成果，说明缺少的可访问资料或额度。'});
  return actions;
}
export function contactOutcome(run){
  if((run.people||[]).length)return {state:'people_need_verification',label:'已整理人物及职业经历，关联和渠道归属交给销售判断',complete:false};
  if((run.channels||[]).length)return {state:'contact_routes_ready',label:'已取得公开联系路径，可交给销售判断；人物资料尚缺',complete:false};
  return {state:'needs_more_evidence',label:'已保存研究进度，尚缺可靠人员或联系方式',complete:false};
}
/** @param {any[]} recommendations @param {{remainingReads?:number,allowedActions?:string[]}} options */
export function modelRecoveryActions(recommendations,{remainingReads=0,allowedActions=[]}={}){
  return recommendations.map(r=>({...r,origin:'model_recommendation',state:remainingReads>0&&allowedActions.includes(r.action)?'automatic':'requires_scope',
    notice:'建议不证明人员身份；执行仍受来源、请求数、费用及已搜索历史约束。'}));
}
