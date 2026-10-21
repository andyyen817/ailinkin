import 'server-only';
import {createHash} from 'node:crypto';
import type {ReviewRow} from '@/domain/contact-review';
export type PersonIdentity={id:string;companyId:string;rowIds:string[];refs:string[]};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function identityRefs(value:{profileUrl?:string;sourcePersonId?:string;providerId?:string}){
  const refs:string[]=[];
  if(value.profileUrl)try{const u=new URL(value.profileUrl);if(u.protocol==='https:'||u.protocol==='http:'){u.hash='';u.search='';refs.push('url:'+u.toString().replace(/\/$/,''));}}catch{}
  if(value.providerId)refs.push('apollo:'+value.providerId);
  if(value.sourcePersonId)refs.push('source:'+value.sourcePersonId);
  return [...new Set(refs)].sort();
}
export function resolvePersonIdentity(campaignId:string,row:Pick<ReviewRow,'id'|'companyId'|'profileUrl'|'identityRefs'>,registry:PersonIdentity[]=[]):PersonIdentity{
  const refs=[...new Set([...(row.identityRefs||[]),...identityRefs(row)])].sort();
  const matches=registry.filter(p=>p.companyId===row.companyId&&(p.rowIds.includes(row.id)||p.refs.some(r=>refs.includes(r))));
  if(matches.length>1)throw Error('PERSON_IDENTITY_AMBIGUOUS');
  const old=matches[0];
  return {id:old?.id||'PI-'+digest([campaignId,row.companyId,row.id]).slice(0,32),companyId:row.companyId,
    rowIds:[...new Set([...(old?.rowIds||[]),row.id])].sort(),refs:[...new Set([...(old?.refs||[]),...refs])].sort()};
}
export function registerPerson(registry:PersonIdentity[],person:PersonIdentity){
  const index=registry.findIndex(p=>p.id===person.id);
  if(index<0)registry.push(person);else registry[index]=person;
}
export function personOwner(rows:ReviewRow[],companyId:string,reference:string){
  const exact=rows.filter(r=>r.kind==='person'&&r.companyId===companyId&&[r.id,r.personId,...(r.identityRefs||[])].includes(reference));
  if(exact.length===1)return exact[0];
  if(exact.length>1)return undefined;
  const byName=rows.filter(r=>r.kind==='person'&&r.companyId===companyId&&r.name.normalize('NFKC').toLowerCase()===reference.normalize('NFKC').toLowerCase());
  return byName.length===1?byName[0]:undefined;
}
