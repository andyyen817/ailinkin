import {z} from 'zod';
import {createHash} from 'node:crypto';
const line=z.string().trim().min(1);
const body=line.superRefine((text,ctx)=>{
  if(text.split(/\s+/).length>150)ctx.addIssue({code:'custom',message:'英文正文最多150词'});
  if(/[\p{Script=Han}]/u.test(text))ctx.addIssue({code:'custom',message:'开发信正文须为英文'});
});
export const outreachDraftSchema=z.object({subjects:z.array(line.max(120)).length(3),first:body,followups:z.array(body).length(2),
  references:z.array(z.object({text:line,sourceId:line,quote:line.min(8)}).strict()).min(1),
}).strict();
export function draftDependencyHash(context:unknown){return createHash('sha256').update(JSON.stringify(context)).digest('hex');}
export function checkedOutreachDraft(raw:unknown,sources:Array<{id:string;quote:string}>,context:unknown){
  const draft=outreachDraftSchema.parse(raw),text=[...draft.subjects,draft.first,...draft.followups].join('\n');
  for(const ref of draft.references){
    const source=sources.find(s=>s.id===ref.sourceId);
    if(!source?.quote.includes(ref.quote)||!text.includes(ref.text))throw Error('OUTREACH_REFERENCE_INVALID');
  }
  return {...draft,dependencyHash:draftDependencyHash(context),review:'待审核事实含义、合作假设及实际发信身份'};
}
