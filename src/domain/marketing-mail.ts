import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^MP-[a-f0-9]{24}$/),rowId=z.string().regex(/^RV-[a-f0-9]{32}$/);
const sender=z.object({email:z.email(),name:z.string().trim().min(1).max(120),company:z.string().trim().min(1).max(200)}).strict();
export const marketingInput=z.discriminatedUnion('action',[
  z.object({action:z.literal('prepare'),campaignId:z.uuid(),handoffId:z.string().regex(/^MH-[a-f0-9]{24}$/),sender,
    messages:z.array(z.object({rowId,subject:z.string().trim().min(1).max(120).refine(v=>!/[\r\n]/.test(v)),body:z.string().trim().min(1).max(12000)}).strict()).min(1).max(50),maxFollowups:z.number().int().min(0).max(2)}).strict(),
  z.object({action:z.enum(['confirm','verify','send','followup','check_replies']),campaignId:z.uuid(),planId:id,expectedBasis:hash}).strict(),
]);
export const marketingScope=z.object({id:z.string().regex(/^MAIL-[A-Z0-9-]{1,80}$/),enabled:z.literal(true),tenantId:z.uuid(),campaignId:z.uuid(),planId:id,basis:hash,
  senderEmail:z.email(),recipientEmails:z.array(z.email()).min(1).max(50),maxMessages:z.number().int().min(1).max(150),maxVerifications:z.number().int().min(0).max(50),
  maxReplyReads:z.number().int().min(0).max(50).default(0),
  approvedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),maxSpendUsd:z.number().min(0).max(10)}).strict();
export type MarketingInput=z.infer<typeof marketingInput>;
