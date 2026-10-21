import 'server-only';
import {createHash} from 'node:crypto';
import {contactSourceAdmission,differentEmployerNames} from '../../scripts/research/contact-source-relevance.mjs';
export function rememberContactSearch(data:any,unit:any,hits:any[],now=new Date().toISOString()){
  const existing=data.contactSearchEvidence||=[],ids:string[]=[];
  for(const hit of hits.slice(0,50)){
    let url:URL;try{url=new URL(hit.url);}catch{continue;}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!hit.snippet?.trim())continue;
    const text=hit.snippet.slice(0,4000),contentHash=createHash('sha256').update(text).digest('hex'),id='CS-'+createHash('sha256').update(JSON.stringify([unit.companyId,unit.query,url.href,contentHash])).digest('hex').slice(0,24);
    ids.push(id);if(existing.some((s:any)=>s.id===id))continue;if(existing.length>=2000)throw Error('CONTACT_SEARCH_EVIDENCE_LIMIT');
    const normalize=(v:string)=>v.normalize('NFKC').toLowerCase().replace(/\s+/g,' '),body=normalize(text);
    const company=data.companies?.find((c:any)=>c.id===unit.companyId)||{name:unit.companyName};
    const admission=contactSourceAdmission(company,hit,{differentEmployers:differentEmployerNames(data,company)});
    existing.push({id,companyId:unit.companyId,companyName:unit.companyName,platform:unit.platform,query:unit.query,targetRowId:unit.targetRowId,admission,
      personName:unit.personName||'',identityMatch:!!unit.personName&&body.includes(normalize(unit.personName))&&body.includes(normalize(unit.companyName)),
      sourceUrl:url.href,title:hit.title||'',quote:text,retrievedAt:now,contentHash,sourceKind:'search_snippet',employerVerified:false,purchaseAuthority:'unknown'});
  }
  const company=data.companies?.find((c:any)=>c.id===unit.companyId)||{name:unit.companyName};
  const checks=existing.filter((s:any)=>ids.includes(s.id)).map((s:any)=>contactSourceAdmission(company,s,{differentEmployers:differentEmployerNames(data,company)}));
  unit.sourceQuality={returned:checks.length,admitted:checks.filter((a:any)=>a.state==='admitted').length,held:checks.filter((a:any)=>a.state==='held').length,rejected:checks.filter((a:any)=>a.state==='rejected').length};
  data.contactSearchEvidence=existing;unit.searchEvidenceIds=ids;return ids;
}
