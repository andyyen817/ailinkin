import 'server-only';
import {createHash} from 'node:crypto';
import type {Campaign} from '@/domain/research';import type {PersonField,PersonSelection} from '@/domain/person-research';
import {contactReviewTable} from './contact-review-table';import {resolvePersonIdentity,registerPerson} from './person-identity';import {AccessError} from './policy';
export const personHash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function personSelectionView(row:Campaign){
  const people=contactReviewTable(row).rows.filter(r=>r.kind==='person'),selection:PersonSelection|null=row.data.personResearchSelection||null;
  return {people,selection,valid:!!selection&&selection.personIds.every(id=>people.some(p=>p.personId===id&&p.basisHash===selection.basis[id]))};
}
export function savePersonSelection(row:Campaign,tenantId:string,actorId:string,input:{personIds:string[];fields:PersonField[];expectedVersion?:string|null},now=new Date().toISOString(),maxPeople=6){
  if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);
  if(row.state==='running')throw new AccessError('CONTACT_RESEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
  const {people,selection}=personSelectionView(row);
  if((selection?.version||null)!==(input.expectedVersion||null))throw new AccessError('PERSON_SELECTION_STALE',409);
  const ids=[...new Set(input.personIds)].sort(),fields=[...new Set(input.fields)].sort();
  if(ids.length!==input.personIds.length||ids.length>Math.min(200,maxPeople)||!fields.length)throw new AccessError('PERSON_SELECTION_INVALID',400);
  const selected=ids.map(id=>{const p=people.find(p=>p.personId===id);if(!p)throw new AccessError('PERSON_NOT_IN_CAMPAIGN',400);return p;});
  const basis=Object.fromEntries(selected.map(p=>[p.personId!,p.basisHash]));
  const version=personHash([ids,fields,basis]);if(version===selection?.version)return {changed:false,view:personSelectionView(row)};
  const history=row.data.personResearchSelections||=[];if(history.length>=100)throw new AccessError('PERSON_SELECTION_HISTORY_LIMIT',409);
  if(selection)history.push(structuredClone(selection));
  const registry=row.data.personIdentities||=[];for(const p of selected)registerPerson(registry,resolvePersonIdentity(row.id,p,registry));
  row.data.personResearchSelection={id:'PS-'+version.slice(0,24),version,personIds:ids,fields,basis,actorId,savedAt:now};
  return {changed:true,view:personSelectionView(row)};
}
