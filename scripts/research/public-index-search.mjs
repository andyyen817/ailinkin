import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {langsearch} from './langsearch.mjs';
import {platformCatalog} from './platform-catalog.mjs';
import {browserPlatformUrl} from './browser-contact-policy.mjs';
export function verifiedFreeIndex(proof){
  const age=Date.now()-Date.parse(proof?.checkedAt);
  return proof?.plan==='Free Plan'&&proof.active===true&&proof.usedPercent>=0&&proof.usedPercent<100&&Number.isFinite(age)&&age>=0&&age<3600000;
}
function loadProof(){
  const p=path.resolve(/* turbopackIgnore: true */ process.env.PUBLIC_LANGSEARCH_FREE_PROOF||'.runtime/disabled');
  if(!p.startsWith(path.resolve(/* turbopackIgnore: true */ '.runtime')+path.sep))throw Error('FREE_PROOF_PATH_REQUIRED');
  const proof=JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ p,'utf8')),img=path.resolve(proof.screenshot);
  if(!img.startsWith(path.resolve('evidence')+path.sep)||createHash('sha256').update(fs.readFileSync(/* turbopackIgnore: true */ img)).digest('hex')!==proof.screenshotSha256)throw Error('FREE_PROOF_EVIDENCE_INVALID');
  return proof;
}
export async function searchPublicIndex(s,base,{fetcher=fetch,key=process.env.LANGSEARCH_API_KEY,proof=/** @type {any} */(undefined)}={}){
  try{proof||=loadProof();}catch{return {...base,state:'restricted',reason:'free_qualification_not_verified'};}
  if(!s.anonymous||!s.scope.engines?.includes('LangSearch')||!verifiedFreeIndex(proof)||!key)return {...base,state:'restricted',reason:'free_index_scope_or_key_unavailable'};
  if(Date.now()>=s.expiresAt||s.usage.networkRequests+s.reservedNetwork>=s.scope.maxNetworkRequests)return {...base,state:'budget_exhausted'};
  let raw,status,requestBody,retryAfterSeconds;
  try{
    await s.resolvePublic(base.url);if(Date.now()>=s.expiresAt)return {...base,state:'budget_exhausted'};
    s.usage.networkRequests++;await s.beforePublicRequest?.(base);
    const results=await langsearch(async(_service,_endpoint,body)=>{
      requestBody=body;s.events.push({action:'public_search_submitted',engine:'LangSearch',query:base.query,url:base.url,at:new Date().toISOString(),transport:'official_free_api'});
      const response=await fetcher(base.url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      status=response.status;const retry=response.headers?.get?.('retry-after');if(retry)retryAfterSeconds=/^\d+$/.test(retry)?Number(retry):Math.max(0,(Date.parse(retry)-Date.now())/1000);
      if(!response.ok){raw=await response.text?.().catch(()=>null);throw Error('HTTP_'+status);}raw=await response.json();return raw;
    },base.query,[],10,undefined,[platformCatalog[base.platform].canonical]);
    const relevant=results.filter(r=>browserPlatformUrl(base.platform,r.url)&&!/(?:help|developers|support|policies)/i.test(new URL(r.url).pathname));
    const responseText=JSON.stringify(raw).replaceAll(key,'[redacted]');
    const responseEvidence={originalQuery:raw.data?.queryContext?.originalQuery||null,logId:raw.log_id||null,returnedCount:raw.data?.webPages?.value?.length||0,contentHash:createHash('sha256').update(responseText).digest('hex')};
    return {...base,state:'read',httpStatus:status,requestBody,responseEvidence,rawResponse:responseText.slice(0,128000),rawTruncated:responseText.length>128000,usage:raw.usage||null,priceUsd:0,transport:'official_free_api',results:relevant.map(r=>({...r,sourceType:'search_snippet',retrievedAt:base.retrievedAt,query:base.query,engine:'LangSearch'})),notice:'免费索引摘要仅为线索，浏览器尚需读取实际来源页'};
  }catch(e){const rawEvidence=raw?JSON.stringify(raw).replaceAll(key,'[redacted]'):null;return {...base,state:status===429?'rate_limited':[500,502,503,504].includes(status)?'upstream_unavailable':status?'restricted':'needs_user_action',httpStatus:status||null,requestBody,priceUsd:0,completedAt:new Date().toISOString(),retryAfterSeconds,reason:status?'free_index_response_invalid_or_unavailable':'free_index_result_unknown_no_retry',rawResponse:rawEvidence?.slice(0,128000),rawTruncated:!!rawEvidence&&rawEvidence.length>128000,diagnostic:status?String(e.message||e).split('\n')[0].replaceAll(key,'[redacted]'):undefined};}
}
