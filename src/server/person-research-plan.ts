import 'server-only';
import type {Campaign} from '@/domain/research';import type {PersonBatch,PersonField,PersonStep} from '@/domain/person-research';
import {personSelectionView,personHash} from './person-research-selection';import {AccessError} from './policy';
export function personResearchPlan(row:Campaign,now=new Date().toISOString()):PersonBatch{
  const view=personSelectionView(row),selection=view.selection;
  if(!view.valid||!selection?.personIds.length)throw new AccessError('PERSON_SELECTION_STALE_OR_EMPTY',409);
  const steps:PersonStep[]=[],people=selection.personIds.map(id=>{
    const p=view.people.find(p=>p.personId===id)!,company=row.data.companies.find((c:any)=>c.id===p.companyId);
    const missing=selection.fields.filter(f=>f==='career'?!p.careerHistory?.some(c=>c.period&&c.status==='current'):f==='profile'?!p.profileUrl:!p.personChannels?.some(c=>f==='work_email'?c.kind==='email':['phone','whatsapp'].includes(c.kind)));
    const known=[...new Set([p.profileUrl,...p.evidence.filter(e=>e.sourceType!=='search_snippet').map(e=>e.sourceUrl)].filter(Boolean))];
    const quote=(s:string)=>'"'+s.replace(/["\r\n]/g,' ').slice(0,150)+'"';
    const queries=missing.length?[`${quote(p.name)} ${quote(p.companyName)} site:linkedin.com/in/`,`${quote(p.name)} ${quote(p.companyName)}`,`${quote(p.name)} ${quote(p.companyName)} contact email`]:[];
    for(const [index,query] of queries.entries())steps.push({id:'PST-'+personHash([id,'search',query]).slice(0,24),personId:id,kind:'search',input:{query,index,companyId:p.companyId,name:p.name},state:'pending'});
    return {personId:id,rowId:p.id,basisHash:p.basisHash,companyId:p.companyId,name:p.name,companyName:p.companyName,country:row.data.project.country||'',domain:company?.domain||company?.website||'',fields:selection.fields,missing,knownUrls:known,queries,
      state:missing.length?'pending':'reused',notice:missing.length?'按缺项补查；人物现任、历史与未知关系均保留':'已有所选字段，仍须销售判断'};
  });
  return {id:'PRB-'+personHash([row.id,selection.id,selection.fields]).slice(0,32),selectionId:selection.id,state:'prepared',people,steps,
    usage:{searches:0,pages:0,network:0,images:0,models:0,usd:0,apollo:0},createdAt:now};
}
export function relevantPersonText(name:string,company:string,text:string){
  const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const body=normalize(text),tokens=normalize(name).split(' ').filter(t=>t.length>1);
  return tokens.length>=2&&tokens.every(t=>body.includes(t))&&normalize(company).split(' ').filter(t=>t.length>2).some(t=>body.includes(t));
}
