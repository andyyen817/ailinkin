import 'server-only';
import {createHash} from 'node:crypto';
import {stringify} from 'csv-stringify/sync';
import type {Campaign} from '@/domain/research';
import {enterpriseSelectionInput} from '@/domain/enterprise-selection';
import {AccessError} from './policy';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function enterpriseRows(row:Campaign){
  const d=row.data,rows=(d.companies||[]).filter((c:any)=>!c.sourceOnly).map((c:any)=>({id:c.id,companyId:c.id,name:c.name,website:c.website||'',
    market:d.project.country,status:c.qualification?.status||'pending',reasons:c.qualification?.reasons||[c.fitReason||'尚需核实企业身份、市场与买方关系'],
    evidence:c.qualification?.evidence||c.discovery||[],identityVerified:!!c.qualification?.identityVerified,marketVerified:!!c.qualification?.marketVerified,buyerVerified:!!c.qualification?.buyerVerified,
    unknowns:c.qualification?.criticalUnknowns||['企业身份、当地经营及合作关系待核实'],cooperationHypothesis:c.analysis?.fit||c.fitReason||'',doNotContact:!!c.doNotContact}));
  for(const e of d.sourcePipeline?.entities||[])if(['company','brand','organization'].includes(e.entityType)&&!rows.some((r:any)=>r.companyId===e.companyId||r.name===e.name))rows.push({id:e.id,companyId:null,name:e.name,website:e.website||'',market:d.project.country,
    status:e.role==='potential_buyer'?'pending':'other_role',reasons:['来源中的企业线索；企业身份和采购关系待核实'],evidence:e.evidence||[],identityVerified:!!e.ownership?.verified,marketVerified:false,buyerVerified:false,unknowns:['当地经营、买方业务及合作关系待核实'],cooperationHypothesis:'',doNotContact:false});
  return rows.map((r:any)=>({...r,basisHash:hash([r,d.project.buyerGroup?.semanticKey,d.project.buyerGroup?.analysisVersion])}));
}
export function enterpriseSelectionView(row:Campaign){
  const rows=enterpriseRows(row),basis=hash(rows.map((r:any)=>[r.id,r.basisHash])),saved=row.data.enterpriseSelection||{decisions:{}};
  const decisions=rows.map((r:any)=>{const old=saved.decisions[r.id],stale=!!old&&old.basisHash!==r.basisHash;
    return {id:r.id,basisHash:r.basisHash,decision:stale?'unreviewed':old?.decision||'unreviewed',note:old?.note||'',stale};});
  const selected=decisions.filter((d:any)=>d.decision==='research').map((d:any)=>d.id),confirmation=saved.confirmation;
  return {rows,basis,decisions,selected,confirmation:confirmation?{...confirmation,valid:confirmation.basis===basis&&confirmation.decisionHash===hash(decisions)}:null};
}
export function applyEnterpriseSelection(row:Campaign,tenantId:string,actorId:string,raw:unknown,now=new Date().toISOString()){
  const input=enterpriseSelectionInput.parse(raw);if(row.id!==input.campaignId||row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);
  if(row.state==='running'||row.data.contactLease||row.data.contactBatchLease)throw new AccessError('SEARCH_BUSY_OR_RECOVERY_REQUIRED',409);
  const view=enterpriseSelectionView(row);if(input.expectedBasis!==view.basis)throw new AccessError('ENTERPRISE_SELECTION_STALE',409);
  if(new Set(input.entries.map(e=>e.id)).size!==input.entries.length)throw new AccessError('DUPLICATE_SELECTION_ROW',400);
  const prior=row.data.enterpriseSelection||{decisions:{},history:[]},saved=structuredClone(prior);
  for(const e of input.entries){const r=view.rows.find((r:any)=>r.id===e.id);if(!r||r.basisHash!==e.basisHash)throw new AccessError('ENTERPRISE_SELECTION_STALE',409);
    const old=saved.decisions[e.id],same=old&&['id','basisHash','decision','note'].every(k=>old[k]===(e as any)[k]);
    if(!same&&(old||e.decision!=='unreviewed'||e.note))saved.decisions[e.id]={...e,actorId,updatedAt:now};}
  if(JSON.stringify(saved.decisions)!==JSON.stringify(prior.decisions)&&saved.confirmation){(saved.history||=[]).push({...saved.confirmation,supersededAt:now});delete saved.confirmation;}
  row.data.enterpriseSelection=saved;const next=enterpriseSelectionView(row);
  if(input.action==='confirm'){
    if(!next.selected.length)throw new AccessError('ENTERPRISE_SELECTION_EMPTY',409);
    if(next.decisions.some((d:any)=>d.stale))throw new AccessError('ENTERPRISE_SELECTION_STALE',409);
    if(!next.confirmation?.valid)saved.confirmation={id:'ES-'+hash([next.basis,next.decisions,now]).slice(0,24),basis:next.basis,decisionHash:hash(next.decisions),selected:next.selected,actorId,confirmedAt:now};
  }
  if((saved.history||[]).length>100)throw new AccessError('SELECTION_HISTORY_LIMIT',409);
  return {view:enterpriseSelectionView(row),changed:JSON.stringify(prior)!==JSON.stringify(saved),externalRequests:0,sent:0};
}
export function enterpriseCsv(row:Campaign){
  const view=enterpriseSelectionView(row),safe=(v:unknown)=>{const s=String(v??'');return /^[\s]*[=+@-]/.test(s)?"'"+s:s;};
  return '\uFEFF'+stringify([['企业','目标市场','官网','初筛状态','理由','依据','用户选择','备注','身份核实','当地经营核实','买方业务核实','合作假设','待核实事项'],...view.rows.map((r:any)=>{const d=view.decisions.find((d:any)=>d.id===r.id)!;
    return [r.name,r.market,r.website,r.status,r.reasons.join('；'),r.evidence.map((e:any)=>(e.url||e.sourceUrl||'')+' '+(e.quote||e.summary||'')).join('；'),d.decision,d.note,r.identityVerified?'有依据':'待核实',r.marketVerified?'有依据':'待核实',r.buyerVerified?'有依据':'待核实',r.cooperationHypothesis,r.unknowns.join('；')].map(safe);})]);
}
