import {createHash} from 'node:crypto';
export function auditedRequest(value){
  if(Array.isArray(value))return value.map(auditedRequest);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>
    [k,/^(authorization|api[_-]?key|cookie|password)$/i.test(k)?'[REDACTED]':auditedRequest(v)]));
  if(typeof value==='string'&&value.startsWith('data:image/')){
    const match=value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if(!match)throw Error('INVALID_INLINE_IMAGE');
    const bytes=Buffer.from(match[2],'base64');
    return {type:'private_image',mime:match[1],bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  return value;
}
export function observedModelUsage(response){
  const u=response?.usage;if(!u)return null;
  const fields=['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'];
  return Object.fromEntries(fields.filter(k=>Number.isInteger(u[k])&&u[k]>=0).map(k=>[k,u[k]]));
}
