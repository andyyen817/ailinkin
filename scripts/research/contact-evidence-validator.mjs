import {z} from 'zod';
import {hash} from './core.mjs';
import {contactDetailFacts} from './contact-detail-fields.mjs';
import {contactCareerClaims} from './contact-career.mjs';
const ref=z.object({id:z.string().min(1),quote:z.string().min(1).max(4000)}).strict();
export const contactModelResult=z.object({people:z.array(z.object({name:z.string().trim().min(1).max(200),title:z.string().max(300),
  relationship:z.enum(['founder','current_employee','former_employee','partner','mentioned','unknown']),
  profileUrl:z.url().optional(),employer:z.string().max(300).optional(),employmentDates:z.array(z.string().min(1).max(100)).max(8).optional(),
  positions:z.array(z.object({employer:z.string().min(1).max(300),title:z.string().max(300),period:z.string().max(100).optional(),
    status:z.enum(['current_claim','former_claim','timing_unknown']),evidence:z.array(ref).min(1).max(8)}).strict()).max(20).optional(),
  contacts:z.array(z.object({kind:z.enum(['email','phone','whatsapp','social']),value:z.string().min(1).max(300),scope:z.enum(['person','company','store','unknown']).optional()}).strict()).max(20).optional(),evidence:z.array(ref).min(1).max(10)}).strict()).max(200),
  unknowns:z.array(z.string().max(500)).max(100),researchNeeds:z.array(z.object({action:z.enum(['look_up_role','look_up_person','verify_employer','verify_channel']),
    target:z.string().trim().min(1).max(200),reason:z.string().min(1).max(400),evidenceId:z.string().max(100).optional()}).strict()).max(5).optional()}).strict();
export function accountIdentity(account,page,company){
  const host=new URL(company.website).hostname.replace(/^www\./,'');
  const backlinks=(page.links||[]).filter(link=>{try{return new URL(typeof link==='string'?link:link.url).hostname.replace(/^www\./,'')===host;}catch{return false;}});
  return {status:account.ownership==='official_link'?'official_link':backlinks.length?'backlink_observed':'unconfirmed',
    ownerType:'unknown',backlinks,notice:'品牌总部、当地运营主体及门店身份仍需核实；账号链接不证明人员或采购权限。'};
}
/** @param {unknown} raw @param {{company:any,blocks:any[],images?:any[]}} input */
export function validateContactPeople(raw,{company,blocks,images=[]}){
  const parsed=contactModelResult.parse(raw),sources=new Map([...blocks,...images].map(s=>[s.id,s]));
  const people=[],keys=new Set();
  for(const person of parsed.people){
    const evidence=[...person.evidence,...(person.positions||[]).flatMap(p=>p.evidence)].map(r=>{
      const source=sources.get(r.id);if(!source)throw Error('UNKNOWN_CONTACT_EVIDENCE');
      if(source.text&&!source.text.includes(r.quote))throw Error('QUOTE_NOT_IN_SOURCE');
      return {id:r.id,sourceUrl:source.sourceUrl,quote:r.quote,retrievedAt:source.retrievedAt,contentHash:source.contentHash,...(source.publishedAt?{publishedAt:source.publishedAt}:{}),
        ...(source.imageId?{imageId:source.imageId}:{}),...(source.sourceType?{sourceType:source.sourceType}:{})};
    });
    if(!evidence.some(e=>e.quote.includes(person.name))||person.title&&!evidence.some(e=>e.quote.includes(person.title)))throw Error('PERSON_FIELD_NOT_IN_QUOTE');
    if(person.profileUrl){
      const u=new URL(person.profileUrl);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('INVALID_PERSON_PROFILE');
      if(!blocks.some(b=>b.text?.includes(person.profileUrl))&&!evidence.some(e=>e.sourceUrl===person.profileUrl))throw Error('PROFILE_NOT_OBSERVED');
    }
    const sourcePersonId='social:'+hash(JSON.stringify([company.id,person.profileUrl||person.name.normalize('NFKC').toLowerCase()])).slice(0,40);
    if(keys.has(sourcePersonId)){people.find(p=>p.sourcePersonId===sourcePersonId).evidence.push(...evidence);continue;}keys.add(sourcePersonId);
    people.push({companyId:company.id,sourcePersonId,name:person.name,title:person.title,profileUrl:person.profileUrl,
      relationship:person.relationship,employerVerified:false,purchaseAuthority:'unknown',evidence,
      ...contactDetailFacts(person,evidence),
      ...contactCareerClaims(person,evidence),
      state:evidence.some(e=>e.imageId)?'image_fields_need_review':'relationship_needs_review',
      notice:'公开人物资料；现任、前任及合作关联保留，具体身份和渠道归属交给销售判断。'});
  }
  const recommendations=(parsed.researchNeeds||[]).filter(r=>r.action==='look_up_role'||r.evidenceId&&sources.has(r.evidenceId)&&
    (sources.get(r.evidenceId).text?.includes(r.target)||people.some(p=>p.name===r.target&&p.evidence.some(e=>e.id===r.evidenceId))));
  return {people,unknowns:parsed.unknowns,recommendations,purchaseIntent:'unknown'};
}
