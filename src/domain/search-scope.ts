import {z} from 'zod';

const text=z.string().trim().min(1).max(800);
export const searchScopeSchema=z.object({
  analysisId:z.uuid(),analysisVersion:z.number().int().positive(),profileId:text,
  application:text,buyerRole:text,
  direction:z.enum(['buys_from_us','refers_orders','operates_our_brand']),
  market:z.object({name:text,mode:z.enum(['headquarters','operating_presence','service_coverage'])}).strict(),
  queries:z.array(z.object({business:text,language:text}).strict()).min(1).max(8),
  decisionRoles:z.array(text).max(20),evidenceIds:z.array(text).min(1).max(40),
}).strict();
export type SearchScope=z.infer<typeof searchScopeSchema>;
// Display names and generated keyword strings are deliberately not identity fields.
export function scopeFacets(scope:SearchScope){
  const normalize=(s:string)=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  return [scope.direction,normalize(scope.application),normalize(scope.buyerRole),
    scope.market.mode,normalize(scope.market.name)];
}
