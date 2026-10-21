import 'server-only';
import {z} from 'zod';
const count=(max:number)=>z.number().int().min(0).max(max);
const hint=z.object({personKey:z.string().min(1).max(180),alias:z.string().trim().max(120).default(''),url:z.string().trim().url().max(1000).optional()}).strict();
export const traceGrantInput=z.object({method:z.literal('trace_v2'),searches:count(98),publicPages:count(196),network:count(500),finder:z.literal(0),verify:count(20),prospeoCredits:z.literal(0),hunterCredits:z.number().min(0).max(10).multipleOf(0.5),minutes:z.number().int().min(5).max(60),pdfs:count(20),pdfPages:z.number().int().min(1).max(10),pdfBytes:z.number().int().min(1).max(5242880),hints:z.array(hint).max(49).default([]),consent:z.literal(true)}).strict();
export function traceLimitFields(input:any){return input.method==='trace_v2'?{pdfs:input.pdfs,pdfPages:input.pdfPages,pdfBytes:input.pdfBytes}:{};}
export function seedTracePeople(people:any[],batches:any[],hints:any[]){
  if(hints.some(h=>!people.some(p=>p.personKey===h.personKey)))throw Error('TRACE_HINT_PERSON_DENIED');
  return people.map(p=>{
    const history=batches.filter(b=>b.mode==='people_enrichment').flatMap(b=>b.people||[]).filter(v=>v.personKey===p.personKey&&v.companyId===p.companyId);
    const unique=(items:any[],key:(v:any)=>string)=>[...new Map(items.map(v=>[key(v),structuredClone(v)])).values()];
    const emailCandidates=unique(history.flatMap(v=>v.emailCandidates||[]),v=>v.value+'|'+JSON.stringify(v.evidence||[]));
    const otherAccounts=unique(history.flatMap(v=>v.otherAccounts||[]),v=>v.value+'|'+v.confirmed);
    const prior=[...history].reverse().find(v=>v.email),owned=emailCandidates.find(c=>c.confirmed);
    const email=owned?.value||prior?.email,technical=[...history].reverse().find(v=>v.email===email&&v.technical)?.technical;
    const selected=hints.filter(h=>h.personKey===p.personKey);
    return {...p,email,emailCandidates,otherAccounts,technical,ownershipEvidence:unique(history.flatMap(v=>v.ownershipEvidence||[]),v=>v.sourceUrl+'|'+v.contentHash),
      traceAliases:[...new Set(selected.map(h=>h.alias).filter(Boolean))],traceSeeds:[...new Set(selected.map(h=>h.url).filter(Boolean))],
      seedEmails:[...new Set([...emailCandidates.map(c=>c.value),email].filter(Boolean))],seedAccounts:otherAccounts.map(a=>a.value),verificationHeld:!!email};
  });
}
