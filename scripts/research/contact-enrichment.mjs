import {host} from './core.mjs';
import {id} from './schema.mjs';
export async function enrichSelected(data,company,api,checkpoint){
  if(company.doNotContact)return;
  const cached=company.contactCandidates;
  const fresh=cached&&Date.parse(cached.expiresAt)>Date.now();
  const people=fresh?cached.people:await api.people(company.website);
  company.contactCandidates={people,expiresAt:fresh?cached.expiresAt:new Date(Date.now()+7*86400000).toISOString()};
  const selected=company.selectedContactIds||[];
  if(!selected.length){company.apolloStatus=people.length?'候选待核实及选择，未补全':'未发现适合联系人';await checkpoint();return;}
  if(selected.length>2||selected.some(key=>!people.some(p=>p.id===key)))throw Error('CONTACT_SELECTION_INVALID');
  const person=people.find(p=>selected.includes(p.id)&&!data.contacts.some(c=>c.companyId===company.id&&c.apolloId===p.id));
  if(person){
    const full=await api.enrich(person);
    const matches=full.employerDomain&&host('https://'+full.employerDomain)===host(company.website);
    if(matches&&full.name&&full.employerEvidence){
      data.contacts.push({...full,id:id('P'),companyId:company.id,employerVerified:true,
        source:'https://api.apollo.io/api/v1/people/match',updatedAt:new Date().toISOString(),suppressed:false});
      api.commit?.();await checkpoint();
    }else{
      company.contactReview={personId:person.id,status:'待核实当前任职',observed:full};
    }
  }
  company.apolloStatus=people.length?'已查询选定联系人':'未发现';
  company.apolloExpiresAt=new Date(Date.now()+30*86400000).toISOString();
}
