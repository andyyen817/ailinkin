import {z} from 'zod';
import {researchPlatform} from './contact-research';
import {sharedResearchBudget} from './shared-research-budget';
const batchId=z.string().regex(/^CB-[a-f0-9]{24}$/);
export const contactBatchInput=z.discriminatedUnion('action',[
  z.object({action:z.literal('prepare'),campaignId:z.uuid(),selectionId:z.string().regex(/^ES-[a-f0-9]{24}$/),platforms:z.array(researchPlatform).min(1).max(9)}).strict(),
  z.object({action:z.enum(['reuse','run','recover']),campaignId:z.uuid(),batchId}).strict(),
]);
export const contactBatchScope=z.object({id:z.string().regex(/^CONTACTBATCH-[A-Z0-9-]{1,80}$/),enabled:z.literal(true),tenantId:z.uuid(),campaignId:z.uuid(),batchId,
  selectionId:z.string().regex(/^ES-[a-f0-9]{24}$/),approvedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),
  maxSearchRequests:z.number().int().min(0).max(200),maxPageReads:z.number().int().min(0).max(200),maxModelRequests:z.number().int().min(0).max(200),
  screenshotsPerPage:z.number().int().min(0).max(2),maxSpendUsd:z.number().min(0).max(20),model:z.literal('deepseek-flash'),
  allowedUrls:z.array(z.url()).max(200),allowedQueries:z.array(z.string().max(800)).max(200),send:z.literal(false),sharedBudget:sharedResearchBudget,
  analysisOnly:z.boolean().optional(),modelSources:z.array(z.object({companyId:z.string().min(1),urls:z.array(z.url()).max(20)}).strict()).max(20).optional(),
  followUpQueries:z.array(z.object({companyId:z.string().min(1),platform:z.literal('网页'),query:z.string().min(1).max(800)}).strict()).max(2).optional(),
  publicDiscovery:z.object({companyIds:z.array(z.string()).min(1).max(100),platforms:z.array(researchPlatform).min(1).max(9),
    maxDepth:z.number().int().min(1).max(2),maxPagesPerCompany:z.number().int().min(1).max(30),maxPagesPerPlatform:z.number().int().min(1).max(30),
    maxChildrenPerPage:z.number().int().min(1).max(5),allowExternalReferences:z.boolean().optional()}).strict().optional()}).strict();
