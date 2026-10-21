import {z} from 'zod';
export const personFields=['career','profile','work_email','public_phone'] as const;
export type PersonField=typeof personFields[number];
export const personResearchInput=z.object({campaignId:z.uuid(),action:z.enum(['save_selection','prepare','start','pause','resume']),
  expectedVersion:z.string().max(100).nullable().optional(),personIds:z.array(z.string().regex(/^PI-[a-f0-9]{32}$/)).max(200).optional(),companyIds:z.array(z.string().max(100)).max(20).optional(),
  fields:z.array(z.enum(personFields)).min(1).max(4).optional(),batchId:z.string().max(100).optional()}).strict();
export type PersonSelection={id:string;version:string;personIds:string[];fields:PersonField[];basis:Record<string,string>;actorId:string;savedAt:string};
export type PersonBudget={searches:number;pages:number;network:number;images:number;models:number;usd:number;apollo:number;finder?:number;verifications?:number};
export const personLimits:PersonBudget={searches:18,pages:12,network:384,images:24,models:4,usd:0.2,apollo:6};
export type PersonStep={id:string;personId:string;kind:'search'|'page'|'model'|'apollo'|'discover'|'finder'|'verify'|'reuse';input:any;state:'pending'|'reserved'|'done'|'failed'|'unknown'|'skipped';result?:any;error?:string;startedAt?:string;finishedAt?:string;reused?:boolean};
export type PersonBatch={id:string;selectionId:string;scopeId?:string;state:'prepared'|'queued'|'running'|'paused'|'done'|'blocked';people:any[];steps:PersonStep[];
  usage:PersonBudget;createdAt:string;startedAt?:string;expiresAt?:string;lease?:{token:string;until:string};pauseRequested?:boolean;notice?:string;planVersion?:number;sourceStates?:Record<string,string>};
export function canResumeSavedPersonBatch(batch:any,selectionId?:string){return batch.state==='paused'&&!!batch.startedAt&&batch.selectionId===selectionId;}
