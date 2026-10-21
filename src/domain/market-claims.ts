import {z} from 'zod';
const text=z.string().trim().min(1).max(1800);
export const marketReference=z.object({sourceId:z.string().max(120),quote:text.min(8)}).strict();
export const marketClaim=z.object({text,kind:z.enum(['fact','hypothesis','unknown']),references:z.array(marketReference).max(12)}).strict()
  .refine(v=>v.kind!=='fact'||v.references.length>0,'FACT_SOURCE_REQUIRED');
