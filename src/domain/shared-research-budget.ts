import {z} from 'zod';
import {createHash} from 'node:crypto';
export const sharedResearchBudget=z.object({id:z.string().regex(/^SHARED-[A-Z0-9-]{1,80}$/),analysisId:z.uuid(),expiresAt:z.iso.datetime(),
  maxSearchRequests:z.number().int().min(0).max(200),maxPageReads:z.number().int().min(0).max(200),maxModelRequests:z.number().int().min(0).max(200),maxSpendUsd:z.number().min(0).max(20),maxNetworkRequests:z.number().int().min(0).max(6400).optional(),maxApolloSearchRequests:z.number().int().min(0).max(3).optional(),maxBrowserSearchRequests:z.number().int().min(0).max(4).optional(),maxApolloAccessChecks:z.literal(1).optional()}).strict();
export type SharedResearchBudget=z.infer<typeof sharedResearchBudget>;
export function reserveSharedLedger(previous:any,raw:unknown,item:{service:string;requestKey:string;reservedCost:number},now=Date.now()){
  const limits=sharedResearchBudget.parse(raw),fingerprint=createHash('sha256').update(JSON.stringify(limits)).digest('hex');
  if(Date.parse(limits.expiresAt)<=now)throw Error('SHARED_BUDGET_EXPIRED');
  if(previous&&previous.fingerprint!==fingerprint)throw Error('SHARED_BUDGET_LIMITS_CHANGED');
  const ledger=previous?structuredClone(previous):{id:limits.id,fingerprint,limits,reservations:[]};
  if(!['langsearch','apollo','apollo_access','browser_search','ai','social_public','public_web','public_network'].includes(item.service)||!item.requestKey||item.requestKey.length>200||item.reservedCost!==(item.service==='ai'?0.05:0))throw Error('SHARED_BUDGET_INVALID_OPERATION');
  if(ledger.reservations.some((r:any)=>r.requestKey===item.requestKey))throw Error('SHARED_BUDGET_REQUEST_ALREADY_RESERVED');
  const caps:Record<string,number>={langsearch:limits.maxSearchRequests,apollo:limits.maxApolloSearchRequests??limits.maxSearchRequests,apollo_access:limits.maxApolloAccessChecks??0,browser_search:limits.maxBrowserSearchRequests??0,ai:limits.maxModelRequests,social_public:limits.maxPageReads,public_web:limits.maxPageReads,public_network:limits.maxNetworkRequests??0};
  if(['public_web','social_public'].includes(item.service)&&ledger.reservations.filter((r:any)=>['public_web','social_public'].includes(r.service)).length>=limits.maxPageReads)throw Error('SHARED_BUDGET_REACHED');
  if(['langsearch','apollo','browser_search'].includes(item.service)&&ledger.reservations.filter((r:any)=>['langsearch','apollo','browser_search'].includes(r.service)).length>=limits.maxSearchRequests)throw Error('SHARED_BUDGET_REACHED');
  if(ledger.reservations.filter((r:any)=>r.service===item.service).length>=caps[item.service]||Number((ledger.reservations.reduce((n:number,r:any)=>n+r.reservedCost,0)+item.reservedCost).toFixed(8))>limits.maxSpendUsd)throw Error('SHARED_BUDGET_REACHED');
  ledger.reservations.push({...item,state:'reserved',reservedAt:new Date(now).toISOString()});return ledger;
}
