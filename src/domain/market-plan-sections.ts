import {z} from 'zod';
import {marketClaim} from './market-claims';
import {buyerDraftSchema} from './company-buyers';
const text=z.string().trim().min(1).max(1800);
export const planSections={
  offerings:z.array(z.object({name:text,description:marketClaim,applications:z.array(marketClaim).max(8)}).strict()).max(12).optional(),
  usps:z.array(z.object({product:text,feature:marketClaim,value:marketClaim,comparison:marketClaim}).strict()).max(15).optional(),
  entryConditions:z.array(z.object({topic:text,requirement:marketClaim,ourReadiness:marketClaim,action:text}).strict()).max(15).optional(),
  searchRecommendations:z.array(z.object({profileId:text,market:text,priority:z.enum(['优先','备选','待补资料']),
    reason:marketClaim,queries:buyerDraftSchema.shape.queries,verify:z.array(text).min(1).max(12)}).strict()).max(12).optional(),
};
export const competitorDetails={
  role:z.enum(['direct','substitute','unknown']).optional(),
  presence:z.object({status:z.enum(['local_evidence','export_only','unknown']),evidence:marketClaim}).strict().optional(),
  products:z.array(marketClaim).max(12).optional(),prices:z.array(marketClaim).max(8).optional(),services:z.array(marketClaim).max(8).optional(),
};
