import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
const verification=z.object({email:z.email(),status:z.enum(['valid','invalid','catch_all','unknown']),
  source:z.url(),providerRequestKey:z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),raw:z.record(z.string(),z.unknown()),rawHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  providerVerifiedAt:z.iso.datetime().nullable().optional(),requestedAt:z.iso.datetime().optional(),
  pending:z.literal(false).optional(),
}).strict();
export function checkedVerification(raw:unknown,email:string,now=Date.now()){
  const v=verification.parse(raw);
  if(v.providerVerifiedAt===null||v.providerVerifiedAt&&v.checkedAt!==v.providerVerifiedAt||v.email.toLowerCase()!==email.toLowerCase()||Date.parse(v.checkedAt)>now||Date.parse(v.expiresAt)<=now||
    Date.parse(v.expiresAt)-Date.parse(v.checkedAt)>30*86400000)throw Error('EMAIL_VERIFICATION_SCOPE_OR_EXPIRY');
  const rawHash=createHash('sha256').update(JSON.stringify(v.raw)).digest('hex');
  if(v.rawHash&&v.rawHash!==rawHash)throw Error('EMAIL_VERIFICATION_RESPONSE_CHANGED');
  return {...v,rawHash};
}
export async function verifyEmail(person:any,provider:(email:string)=>Promise<unknown>,now=Date.now()){
  if(!person.email)return {status:'unavailable',reused:false};
  if(person.emailVerification){
    try{return {...checkedVerification(person.emailVerification,person.email,now),reused:true};}catch{}
  }
  const result=checkedVerification(await provider(person.email),person.email,now);
  person.emailVerification=result;return {...result,reused:false};
}
export function emailEligibility(company:any,person:any,scopeKey:string,analysisVersion:number,now=Date.now()){
  const reasons=[],q=company.qualification;
  if(q?.status!=='qualified'||q.scopeKey!==scopeKey||q.analysisVersion!==analysisVersion)reasons.push('当前客户适配尚未核实');
  if(company.doNotContact||person.suppressed)reasons.push('已禁止联系');
  if(person.employerVerified!==true)reasons.push('当前任职尚未核实');
  if(!person.email)reasons.push('尚无企业邮箱');
  else{
    try{if(checkedVerification(person.emailVerification,person.email,now).status!=='valid')reasons.push('邮箱未确认可用');}
    catch{reasons.push('邮箱验证缺少依据或已经过期');}
  }
  return {eligible:reasons.length===0,reasons};
}
