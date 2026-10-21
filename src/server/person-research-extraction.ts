import 'server-only';
import {contactVision,contactExtractionKey} from '../../scripts/research/contact-vision.mjs';
import {relevantPersonText} from './person-research-plan';
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function personMaterials(people:any[],pages:any[]){
  const eligible=pages.filter(p=>people.some(t=>relevantPersonText(t.name,t.companyName,(p.blocks||[]).map((b:any)=>b.text).join('\n'))));
  const blocks=[...new Map(eligible.flatMap(p=>p.blocks||[]).map(b=>[b.contentHash,b])).values()] as any[];
  const relevant=blocks.filter((b:any)=>people.some(p=>normalize(b.text).includes(normalize(p.name))));
  const selected:any[]=[];let size=0;for(const b of relevant){if(selected.length>=16||size+b.text.length>64000)continue;selected.push(b);size+=b.text.length;}
  return selected;
}
export function enforcePersonContacts(person:any){
  return {...person,contacts:(person.contacts||[]).map((c:any)=>{
    const evidence=c.evidence?.length?c.evidence:person.evidence||[];
    const direct=evidence.some((e:any)=>normalize(e.quote||'').includes(normalize(person.name))&&(e.quote||'').includes(c.value));
    const companyInbox=c.kind==='email'&&/^(?:info|contact|hello|wecare|sales|admin|support|enquir|office|customerservice)[.@_-]/i.test(c.value);
    const masked=/\*|\u2022|\[at\]/.test(c.value||'');
    return {...c,scope:companyInbox?'company':direct&&!masked&&c.scope==='person'?'person':'unknown',evidence,
      verification:'ownership_needs_review'};
  })};
}
export async function extractSelectedPeople(company:any,people:any[],pages:any[],call:any,previous:any[]=[],options:any={}){
  const blocks=personMaterials(people,pages);if(!blocks.length)return {state:'no_relevant_material',people:[],requests:0};
  const images=pages.filter(p=>p.relevant).flatMap(p=>p.images||[]).slice(0,4),input={company,blocks,images,...options};
  const key=contactExtractionKey(input),cached=previous.find(r=>r.extractionKey===key);
  if(cached){const all=[...(cached.people||[]),...(cached.otherPeople||[])];
    return {...cached,people:all.filter((p:any)=>people.some(t=>normalize(t.name)===normalize(p.name))).map(enforcePersonContacts),
      otherPeople:all.filter((p:any)=>!people.some(t=>normalize(t.name)===normalize(p.name))),reused:true,requests:0};}
  const result=await contactVision(call,input);
  const selected=result.people.filter((p:any)=>people.some(t=>normalize(t.name)===normalize(p.name))).map(enforcePersonContacts);
  return {...result,people:selected,otherPeople:result.people.filter((p:any)=>!selected.some((s:any)=>s.name===p.name)),state:'extracted',requests:1};
}
