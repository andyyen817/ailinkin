import {z} from 'zod';

export const stages=['待筛选','已入选','待联系','联系中','已回复','有意向','已约会议','已关闭'] as const;
export const emailStates=['verified','unverified','catch_all','invalid','unavailable','unknown'] as const;
export function normalizeLinkedin(value:string){
 if(!value.trim())return '';
 const url=new URL(value.trim());
 if(!['https:','http:'].includes(url.protocol)||!/(^|\.)linkedin\.com$/i.test(url.hostname)||url.username||url.password||url.port)throw Error('INVALID_LINKEDIN_URL');
 const path=url.pathname.replace(/\/+$/,'');
 if(!/^\/in\/[^/]+$/i.test(path))throw Error('INVALID_LINKEDIN_PROFILE');
 return `https://www.linkedin.com${path.toLowerCase()}`;
}
const short=z.string().trim().max(300);
export const contactSchema=z.object({
 name:short.min(1),company:short.min(1),title:short.default(''),country:short.default(''),
 email:z.union([z.literal(''),z.email()]).transform(v=>v.toLowerCase()).default(''),
 linkedin:short.transform((v,ctx)=>{try{return normalizeLinkedin(v);}catch{ctx.addIssue({code:'custom',message:'INVALID_LINKEDIN_URL'});return z.NEVER;}}).default(''),
 emailStatus:z.enum(emailStates).default('unknown'),tags:z.array(short.min(1)).max(30).transform(v=>[...new Set(v)]).default([]),
 notes:z.string().max(10000).default(''),stage:z.enum(stages).default('待筛选'),
 notInterested:z.boolean().default(false),doNotContact:z.boolean().default(false),
 ownerId:z.string().min(1).max(100).nullable().default(null),
}).strict();
export type ContactData=z.infer<typeof contactSchema>;
