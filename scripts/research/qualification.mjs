import {hash} from './core.mjs';

export function scopeVersion(project){
  const group=project.buyerGroup||{};
  return {scopeKey:project.scopeId||group.semanticKey||'legacy',analysisVersion:group.analysisVersion||project.analysis?.version||1};
}
export function qualify(result,evidence,company,project){
  const draft=result.qualification||{},checks=['identity','market','buyer','cooperation'];
  const missing=[],accepted=[];
  for(const key of checks){
    const claim=draft[key],source=evidence.find(e=>e.id===claim?.evidenceId);
    const valid=claim?.matched===true&&typeof claim.quote==='string'&&claim.quote.length>=8&&
      source?.platform==='网页'&&source.quote.includes(claim.quote)&&claim.explanation?.trim();
    if(valid)accepted.push({sourceId:source.id,url:source.url,quote:claim.quote});
    else missing.push(key+'依据尚未核实');
  }
  const relation=draft.direction;
  if(!project.buyerGroup?.ready||!['buys_from_us','refers_orders','operates_our_brand'].includes(relation))missing.push('买方交易关系待核实');
  if(project.buyerGroup?.searchSpecs?.some(s=>s.direction!==relation))missing.push('交易方向与当前画像不一致');
  const conflicts=Array.isArray(draft.conflicts)?draft.conflicts.filter(c=>{
    const source=evidence.find(e=>e.id===c.evidenceId);
    return source&&typeof c.quote==='string'&&c.quote.length>=8&&source.quote.includes(c.quote)&&c.reason?.trim();
  }):[];
  const unknowns=[...new Set([...missing,...(Array.isArray(draft.criticalUnknowns)?draft.criticalUnknowns.filter(x=>typeof x==='string'&&x.trim()):[])])];
  const status=conflicts.length?'unfit':unknowns.length?'pending':'qualified';
  return {status,...scopeVersion(project),identityVerified:!missing.some(s=>s.startsWith('identity')),
    marketVerified:!missing.some(s=>s.startsWith('market')),buyerVerified:!missing.some(s=>s.startsWith('buyer')),
    reasons:conflicts.length?conflicts.map(c=>c.reason):unknowns.length?unknowns:['已引用官网事实支持身份、市场、买方业务和合作关系；不表示实际采购意愿'],
    evidence:accepted,criticalUnknowns:unknowns,updatedAt:new Date().toISOString()};
}
export function qualificationVersion(project,company,evidence){
  return hash(JSON.stringify([scopeVersion(project),project.buyerGroup,company.assetId||company.id,evidence]));
}
