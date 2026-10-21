export async function cachedRequest(tx,tenant,key){
  const [r]=await tx.$queryRaw`SELECT state,response,expires_at,parameters FROM query_checkpoint
    WHERE tenant_id=${tenant} AND request_key=${key}`;
  if(!r)return null;
  return {id:r.parameters.requestId,status:r.state,response:r.response,applied:true,
    expiresAt:r.expires_at?.toISOString(),externalCache:true};
}
export async function persistRequest(tx,tenant,scopeId,r){
  if(!scopeId||!['pending','done','unknown','failed'].includes(r.status))return;
  const parameters=JSON.stringify({requestId:r.id,route:r.route,body:r.requestBody});
  const response=r.response?JSON.stringify(r.response):null;
  const domains=r.requestBody?.excludeDomains||r.requestBody?.not_organization_websites_list||
    (r.requestBody?.exclude?r.requestBody.exclude.split('|'):[]);
  const exclusionHash=createHash('sha256').update(JSON.stringify([...domains].sort())).digest('hex');
  const rows=await tx.$queryRaw`INSERT INTO query_checkpoint(tenant_id,request_key,scope_id,provider,parameters,state,response,exclusion_hash,reserved_units,expires_at)
    VALUES(${tenant},${r.key},${scopeId},${r.service},${parameters}::jsonb,${r.status},${response}::jsonb,
      ${exclusionHash},${r.reservedCredits||0},${r.expiresAt?new Date(r.expiresAt):null})
    ON CONFLICT(tenant_id,request_key) DO UPDATE SET state=EXCLUDED.state,response=EXCLUDED.response,
      parameters=EXCLUDED.parameters,reserved_units=EXCLUDED.reserved_units,scope_id=EXCLUDED.scope_id,
      exclusion_hash=EXCLUDED.exclusion_hash,generation=CASE WHEN query_checkpoint.parameters->>'requestId'=EXCLUDED.parameters->>'requestId'
        THEN query_checkpoint.generation ELSE query_checkpoint.generation+1 END,
      expires_at=EXCLUDED.expires_at,updated_at=now()
    WHERE query_checkpoint.parameters->>'requestId'=EXCLUDED.parameters->>'requestId'
      OR query_checkpoint.state NOT IN ('pending','unknown')
    RETURNING request_key`;
  if(!rows.length)throw Error('REQUEST_PENDING_OR_UNKNOWN');
}
export async function persistCampaignRequests(tx,tenant,scopeId,requests){
  // The immutable ledger retains every attempt; a checkpoint publishes only its latest head.
  const heads=new Map(requests.map((r,i)=>[r.key||r.id||'legacy:'+i,r]));
  for(const request of heads.values())await persistRequest(tx,tenant,scopeId,request);
}
import {createHash} from 'node:crypto';
import {findCompany} from './company-identity.mjs';
import {id,platformsFor} from './schema.mjs';
export function reuseAttempts(data,histories,now=Date.now()){
  for(const history of histories){
    if(history.project?.tenantId!==data.project.tenantId)continue;
    for(const old of history.attempts||[]){
      if(!old.current||!old.status?.startsWith('已完成')||Date.parse(old.expiresAt)<=now||!Number.isFinite(Date.parse(old.expiresAt)))continue;
      if(!platformsFor(data.project).includes(old.platform))continue;
      const original=history.companies.find(c=>c.id===old.companyId),company=original&&findCompany(data.companies,original);
      if(!company||data.attempts.some(a=>a.companyId===company.id&&a.platform===old.platform&&a.current))continue;
      data.attempts.push({...structuredClone(old),id:id('T'),attemptId:id('A'),companyId:company.id,
        reusedAttemptId:old.attemptId,reusedFromCampaign:history.id,scope:'v1'});
      data.reusedSourceCount=(data.reusedSourceCount||0)+1;
    }
  }
}
