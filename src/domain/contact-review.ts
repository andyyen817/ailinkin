import {z} from 'zod';
export type ReviewEvidence={sourceUrl:string;quote:string;retrievedAt?:string;contentHash?:string;publishedAt?:string;sourceType?:'search_snippet'|'social_body'|'website_body'|'provider_receipt'};
export type CareerClaim={employer:string;title:string;period:string;status:string;verification:string;evidence:ReviewEvidence[]};
export type ContactCheck={ownership?:string;provenance?:string;channelEmployer?:string;targetEmployer?:string;providerId?:string;observedAt?:string;technicalHistory?:unknown[];technical?:{status:string;requestedAt:string;verifiedAt:string|null;expiresAt:string|null;pending?:boolean}};
export type ReviewRow={id:string;basisHash:string;companyId:string;companyName:string;kind:'person'|'channel';name:string;title:string;
  personId?:string;identityRefs?:string[];ownerPersonId?:string;ownerRef?:string;legacyBasisHash?:string;
  relationship:string;scope:string;channelKind:string;value:string;email:string;phone:string;profileUrl:string;
  employerVerified:boolean;purchaseAuthority:string;verification:string;doNotContact:boolean;evidence:ReviewEvidence[];crmContactId:string;platforms:string[];
  employerClaim?:string;employmentDates?:string[];detailUnknowns?:string[];affiliationStatus?:string;rejectedRelationship?:string;admissionState?:string;
  checks?:ContactCheck;careerHistory?:CareerClaim[];careerUnknowns?:string[];personChannels?:({kind:string;value:string;scope:string;evidence:ReviewEvidence[]}&ContactCheck)[]};
export type Judgment={rowId:string;basisHash:string;decision:'unreviewed'|'keep'|'exclude'|'needs_info';emailSelected:boolean;note:string};
export type ReviewTable={rows:ReviewRow[];tableHash:string;coverage:{companyId:string;companyName:string;platform:string;state:string;notice:string}[];
  tableReady:boolean;collectionComplete:boolean};
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const common={campaignId:z.uuid(),expectedTableHash:hash};
export const reviewInput=z.discriminatedUnion('action',[
  z.object({...common,action:z.literal('save_judgments'),entries:z.array(z.object({rowId:z.string().regex(/^RV-[a-f0-9]{32}$/),basisHash:hash,
    decision:z.enum(['unreviewed','keep','exclude','needs_info']),emailSelected:z.boolean(),note:z.string().max(1000)}).strict()).max(2000)}).strict(),
  z.object({...common,action:z.literal('confirm_review')}).strict(),
  z.object({...common,action:z.literal('finish_batch'),companyIds:z.array(z.string().min(1).max(160)).min(1).max(20).optional()}).strict(),
]);
export type ReviewInput=z.infer<typeof reviewInput>;
export function emailSelectable(row:ReviewRow){return row.kind==='channel'&&row.channelKind==='email'&&!row.doNotContact&&row.verification!=='invalid'&&z.email().safeParse(row.email).success;}
