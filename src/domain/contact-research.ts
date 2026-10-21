import {z} from 'zod';
import {platformCatalog} from '../../scripts/research/platform-catalog.mjs';
export const researchPlatform=z.enum(Object.keys(platformCatalog) as [string,...string[]]);
export const companyId=z.string().regex(/^C-[a-f0-9-]{36}$/);
const publicLink=z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port;},'PUBLIC_HTTPS_REQUIRED');
const sourceLink=z.url().refine(value=>{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port;},'PUBLIC_SOURCE_REQUIRED');
export const contactResearchInput=z.object({action:z.literal('prepare'),campaignId:z.uuid(),companyIds:z.array(companyId).min(1).max(20),platforms:z.array(researchPlatform).min(1).max(9)}).strict();
export const contactEvidence=z.object({id:z.string().min(1).max(100),sourceUrl:sourceLink,quote:z.string().trim().min(1).max(4000),
  retrievedAt:z.iso.datetime(),contentHash:z.string().regex(/^[a-f0-9]{64}$/),imageId:z.string().min(1).max(100).optional()}).strict();
export const accountFinding=z.object({companyId,platform:researchPlatform,url:publicLink,
  ownership:z.enum(['unconfirmed','official_link','verified']),ownerType:z.enum(['unknown','headquarters','local_operator','store','unrelated']),
  evidence:z.array(contactEvidence).min(1).max(100),readState:z.enum(['not_started','cached_text','needs_access','blocked']),
  identityNotice:z.string().max(300).optional(),sourceExpired:z.boolean().optional()}).strict();
export const personFinding=z.object({companyId,name:z.string().trim().min(1).max(200),title:z.string().max(300),
  sourcePersonId:z.string().min(1).max(800).optional(),profileUrl:publicLink.optional(),
  relationship:z.enum(['founder','current_employee','former_employee','mentioned','unknown']),
  employerVerified:z.boolean(),purchaseAuthority:z.enum(['unknown','evidenced']),authorityEvidenceId:z.string().max(100).optional(),
  evidence:z.array(contactEvidence).min(1).max(100)}).strict().superRefine((v,ctx)=>{
    if(v.employerVerified&&!['founder','current_employee'].includes(v.relationship))ctx.addIssue({code:'custom',message:'CURRENT_EMPLOYER_EVIDENCE_REQUIRED'});
    if(v.purchaseAuthority==='evidenced'&&(!v.authorityEvidenceId||!v.evidence.some(e=>e.id===v.authorityEvidenceId)))ctx.addIssue({code:'custom',message:'PURCHASE_AUTHORITY_EVIDENCE_REQUIRED'});
});
export const businessChannel=z.object({companyId,personId:z.string().min(1).max(800).optional(),kind:z.enum(['email','phone','whatsapp','contact_page']),
  value:z.string().trim().min(1).max(1000),scope:z.enum(['company','store','person']),
  verification:z.enum(['unknown','unverified','valid','invalid','catch_all']),verificationEvidenceId:z.string().max(100).optional(),
  evidence:z.array(contactEvidence).min(1).max(100)}).strict().superRefine((v,ctx)=>{
    if(v.scope==='person'&&!v.personId)ctx.addIssue({code:'custom',message:'PERSON_CHANNEL_IDENTITY_REQUIRED'});
    if(v.kind==='email'&&!z.email().safeParse(v.value).success)ctx.addIssue({code:'custom',message:'INVALID_EMAIL'});
    if(v.kind==='contact_page'&&!publicLink.safeParse(v.value).success)ctx.addIssue({code:'custom',message:'INVALID_CONTACT_PAGE'});
    if(['phone','whatsapp'].includes(v.kind)&&!/^[+()\d][\d\s()+.-]{6,30}$/.test(v.value))ctx.addIssue({code:'custom',message:'INVALID_BUSINESS_PHONE'});
    if(v.verification==='valid'&&!v.verificationEvidenceId)ctx.addIssue({code:'custom',message:'VERIFICATION_EVIDENCE_REQUIRED'});
});
export type ContactResearchInput=z.infer<typeof contactResearchInput>;
export type ContactAccount=z.infer<typeof accountFinding>;
export type ContactPerson=z.infer<typeof personFinding>;
export type BusinessChannel=z.infer<typeof businessChannel>;
