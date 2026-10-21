const norm=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/&#(?:x0*27|0*39);|&apos;|&rsquo;|&lsquo;|[‘’]/gi,"'").replace(/\s+/g,' ').trim();
const escaped=v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const mentions=(text,name)=>!!name&&new RegExp('(^|[^\\p{L}\\p{N}])'+escaped(norm(name))+'($|[^\\p{L}\\p{N}])','u').test(norm(text));
export const contactAdmissionVersion='company-association-v3';
const countries=[['印尼','Indonesia','Indonesian'],['菲律宾','菲律賓','Philippines','Filipino'],['美国','美國','United States','USA','U.S.']];
/** @param {any} company @param {any} hit @param {{differentEmployers?:string[]}} options */
export function contactSourceAdmission(company,hit,options={}){
  const differentEmployers=options.differentEmployers||[];
  const text=[hit.title,hit.snippet,hit.quote,hit.text].filter(Boolean).join(' '),names=[company.name,...(company.verifiedAliases||[])];
  const reasons=[],result={version:contactAdmissionVersion,state:'held',companyMatch:names.some(n=>mentions(text,n)),marketStatus:'unknown',reasons};
  let url,host;try{url=new URL(hit.url||hit.sourceUrl);host=url.hostname.replace(/^www\./,'');}catch{reasons.push('来源网址无效');return result;}
  const platformHelp=/^(?:developers?|support|help|code)\./i.test(host)||
    /(?:^|\/)(?:help|developers?|support|docs|documentation|policies|privacy|terms)(?:\/|$)/i.test(url.pathname);
  if(platformHelp){result.state='rejected';reasons.push('平台帮助、开发文档或政策页面，不进入目标人员研究');return result;}
  const official=company.officialOwnership?.result?.ownership?.verified===true||company.officialOwnership?.verified===true;
  const ownHost=(()=>{try{return new URL(company.website).hostname.replace(/^www\./,'');}catch{return '';}})();
  const officialSource=official&&host===ownHost;
  if(!officialSource&&!result.companyMatch){reasons.push('正文／标题没有研究企业或已核实别名');return result;}
  const otherNames=differentEmployers.filter(n=>mentions(text,n));
  const remaining=otherNames.reduce((v,n)=>v.replace(new RegExp(escaped(norm(n)),'gu'),' '),norm(text));
  if(!officialSource&&otherNames.length&&!names.some(n=>mentions(remaining,n))){
    reasons.push('研究企业名称仅出现在另一家企业全名中；同名主体待核实');return result;
  }
  const target=company.targetMarket||'',terms=countries.find(c=>c.some(n=>norm(n)===norm(target)))||[target];
  const marketQuotes=(company.qualification?.evidence||[]).map(e=>e.quote||'').join(' ');
  const knownMarket=terms.some(n=>mentions(marketQuotes,n)),observedMarket=terms.some(n=>mentions(text,n));
  const conflicting=countries.some(c=>!c.includes(terms[0])&&c.some(n=>mentions(text,n)));
  if(observedMarket)result.marketStatus='source_mentions_target';
  else if(knownMarket&&officialSource)result.marketStatus='saved_company_evidence';
  if(conflicting&&!observedMarket)reasons.push('来源提到其他国家；不排除历史任职或跨国关联，具体主体仍需核实');
  if(otherNames.length)reasons.push('另有任职企业提及；分别保留现任、历史任职及合作关系');
  result.state='admitted';reasons.push(officialSource?'已核实官网来源':'有研究企业提及；属于研究材料，不证明人员任职');
  if(result.marketStatus==='unknown')reasons.push('本来源缺目标国家依据；不作为当地任职证明');
  return result;
}
export function observedEmployerName(person){
  const m=String(person.title||'').match(/\s(?:at|@)\s+(.+)$|(?:manager|director|owner|founder|employee)\s+of\s+(.+)$/i);
  return person.employerClaim||m?.[1]||m?.[2]||'';
}
export function differentEmployerNames(data,company){
  const names=[company.name,...(company.verifiedAliases||[])].map(norm);
  return [...new Set((data.contactResearchRuns||[]).filter(r=>r.companyId===company.id).flatMap(r=>(r.people||[])
    .map(observedEmployerName).filter(n=>n&&!names.includes(norm(n)))))];
}
