import {emailContactState} from './personal-contact-summary';
export function traceContactSummary(people:any[],now=Date.now()){
  const emails=people.flatMap(p=>(p.emailCandidates||[]).map((c:any)=>({...c,personKey:p.personKey,isNew:!(p.seedEmails||[]).includes(c.value)})));
  const accounts=people.flatMap(p=>(p.otherAccounts||[]).map((a:any)=>({...a,personKey:p.personKey,isNew:!(p.seedAccounts||[]).includes(a.value)})));
  const unique=(a:any[])=>[...new Map(a.map(v=>[v.personKey+'|'+v.value,v])).values()];
  return {people:people.length,processed:people.filter(p=>p.enrichmentComplete).length,emails:unique(emails).length,
    ownedEmails:unique(emails.filter(c=>c.confirmed)).length,newOwnedEmails:unique(emails.filter(c=>c.confirmed&&c.isNew)).length,
    confirmedOtherAccounts:unique(accounts.filter(a=>a.confirmed)).length,newConfirmedOtherAccounts:unique(accounts.filter(a=>a.confirmed&&a.isNew)).length,
    candidateOtherAccounts:unique(accounts.filter(a=>!a.confirmed)).length,
    validEmails:people.filter(p=>p.email&&emailContactState(p,now)==='技术验证通过').length};
}
export function traceEvidenceDescription(e:any){return [e.pageNumber?'PDF第'+e.pageNumber+'页':'网页正文',e.ownerProof||'',e.quote||''].filter(Boolean).join('：').slice(0,1200);}
