import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^(?:C-[a-f0-9-]{36}|E-[a-f0-9]{24})$/);
export const enterpriseSelectionInput=z.object({action:z.enum(['save','confirm']),campaignId:z.uuid(),expectedBasis:hash,
  entries:z.array(z.object({id,basisHash:hash,decision:z.enum(['unreviewed','research','exclude','needs_info']),note:z.string().max(1000)}).strict()).max(2000)}).strict();
export type EnterpriseDecision=z.infer<typeof enterpriseSelectionInput>['entries'][number];
