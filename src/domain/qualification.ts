import {z} from 'zod';

export const qualificationSchema=z.object({
  status:z.enum(['qualified','conditional','pending','unfit','duplicate']),
  scopeKey:z.string().min(1),analysisVersion:z.number().int().positive(),
  identityVerified:z.boolean(),marketVerified:z.boolean(),buyerVerified:z.boolean(),
  reasons:z.array(z.string().trim().min(1)).min(1),
  evidence:z.array(z.object({sourceId:z.string().min(1),url:z.url(),quote:z.string().trim().min(1)}).strict()),
  criticalUnknowns:z.array(z.string()),updatedAt:z.iso.datetime(),
}).strict().superRefine((q,ctx)=>{
  if(q.status==='qualified'&&(!q.identityVerified||!q.marketVerified||!q.buyerVerified||!q.evidence.length||q.criticalUnknowns.length)){
    ctx.addIssue({code:'custom',message:'有效企业需要身份、市场、买方证据且没有关键未知'});
  }
});
export type Qualification=z.infer<typeof qualificationSchema>;
export function qualificationCounts(companies:Array<{id:string;qualification?:unknown}>,scopeKey:string,version:number){
  const seen=new Set<string>();let qualified=0,pending=0,unfit=0;
  for(const company of companies){
    if(seen.has(company.id))continue;seen.add(company.id);
    const parsed=qualificationSchema.safeParse(company.qualification);
    if(!parsed.success||parsed.data.scopeKey!==scopeKey||parsed.data.analysisVersion!==version){pending++;continue;}
    if(parsed.data.status==='qualified')qualified++;
    else if(parsed.data.status==='unfit')unfit++;
    else pending++;
  }
  return {candidates:seen.size,qualified,pending,unfit};
}
