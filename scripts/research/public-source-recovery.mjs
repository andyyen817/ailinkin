const transient=new Set([500,502,503,504]);
export function officialCompanyLabel(company){
  try{if(!company.qualification?.identityVerified)return company.name;
    const host=new URL(company.website).hostname.replace(/^www\./,'');
    for(const e of company.qualification.evidence||[]){if(new URL(e.url).hostname.replace(/^www\./,'')!==host)continue;
      const label=e.quote?.match(/\|\s*([^|\n#]{2,80}?)\s+Loading\b/i)?.[1]?.trim();
      if(label&&label.toLowerCase().includes(company.name.toLowerCase()))return label;}
  }catch{}return company.name;
}
export function publicSourceRecovery(history,scopeId,engine,now=Date.now()){
  const records=history.filter(j=>j.scopeId===scopeId).flatMap(j=>j.page?.searches||[]).filter(q=>q.engine===engine);
  const unique=[...new Map(records.map(q=>[q.key+':'+q.retrievedAt,q])).values()];
  const failures=unique.filter(q=>transient.has(q.httpStatus));
  const hard=unique.some(q=>['pending_unknown','needs_user_action','rate_limited','robots_denied','robots_unknown'].includes(q.state)||q.state==='restricted'&&!transient.has(q.httpStatus));
  const last=failures.at(-1),delay=last?Math.max(5,last.retryAfterSeconds||0):0;
  return {allowRecovery:!hard&&failures.length===1,stop:hard||failures.length>=2||delay>30,failedQueries:failures.map(q=>q.query),
    readyAt:last?Date.parse(last.completedAt||last.retrievedAt)+delay*1000+Math.floor(Math.random()*1000):0,failures:failures.length};
}
