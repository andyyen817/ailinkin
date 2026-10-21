import {z} from 'zod';
import {companyId,researchPlatform} from './contact-research';
export const browserContactInput=z.object({action:z.enum(['open','search_collect','collect_current','public_batch','public_direct','public_discovery','analyze','close']),campaignId:z.uuid(),companyId,
  platform:researchPlatform.refine(p=>p!=='网页'),personName:z.string().trim().max(200).optional(),collectionId:z.string().regex(/^BC-[a-f0-9]{24}$/).optional()}).strict();
export const browserContactScope=z.object({id:z.string().regex(/^BROWSER-[A-Z0-9-]+$/),enabled:z.literal(true),tenantId:z.uuid(),operatorId:z.uuid(),campaignId:z.uuid(),
  campaignIds:z.array(z.uuid()).min(1).max(2).optional(),
  companyIds:z.array(companyId).min(1).max(3),platforms:z.array(researchPlatform).min(1).max(8),approvedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),
  maxPageReads:z.number().int().min(1).max(24),maxNetworkRequests:z.number().int().min(1).max(768),maxScreenshots:z.number().int().min(0).max(48),
  maxModelRequests:z.number().int().min(0).max(3),maxSpendUsd:z.number().min(0).max(.15),
  priorBatchId:z.string().regex(/^CB-[a-f0-9]{24}$/),modelTotalLimit:z.literal(6),modelTotalBudget:z.literal(.40),
  mode:z.enum(['visible_browser_only','anonymous_public']),engines:z.array(z.enum(['Google','Bing','LangSearch'])).min(1).max(3).optional(),
  maxSearchQueries:z.number().int().min(1).max(12).optional(),retryPreflightUrl:z.url().max(2000).optional(),singlePublicPreviewUrl:z.url().max(2000).optional(),
  discoverySourceUrls:z.array(z.url().max(2000)).max(3).optional(),discoveryPreviewUrls:z.array(z.url().max(2000)).max(3).optional(),
  discoveryPersonNames:z.array(z.string().trim().min(1).max(200)).max(1).optional(),send:z.literal(false)}).strict().superRefine((v,ctx)=>{
    if(v.discoveryPreviewUrls?.some(url=>!v.discoverySourceUrls?.includes(url)))ctx.addIssue({code:'custom',message:'Discovery previews require separately scoped observed source URLs'});
    if(v.campaignIds&&!v.campaignIds.includes(v.campaignId))ctx.addIssue({code:'custom',message:'Primary campaign must be explicitly included'});
    if(v.mode==='anonymous_public'&&(!v.engines?.length||!v.maxSearchQueries))
      ctx.addIssue({code:'custom',message:'Anonymous batch requires explicit engines and search quota'});
  });
export type BrowserContactInput=z.infer<typeof browserContactInput>;
