import 'server-only';import {createHash} from 'node:crypto';
import {checkedAlternativeScope} from '@/domain/shortlist-alternative';
import {currentEntities} from '../../scripts/research/buyer-pipeline.mjs';
import {transport} from '../../scripts/research/http.mjs';
import {locateOrganizations} from '../../scripts/research/apollo-locator.mjs';
export async function executeApolloAlternative(row:any,save:any,config:any,fetcher:typeof fetch=fetch){
 const d=row.data,s=checkedAlternativeScope(config.alternativeScope,row),source=config.alternativeSource,key=config.keys?.APOLLO_API_KEY;
 if(!key||!config.beforeSend||config.apolloTrialTenant!==row.tenant_id)throw Error('APOLLO_SCOPED_KEY_REQUIRED');
 d.shortlist ||= {revision:0,network:[],scopeIds:[]};
 const persist=async(state:string,message:string)=>{row.data=d;await save(state,message);};
 const checkpoint=()=>persist('running','正在核查已授权的Apollo企业入口');
 const guard=async(item:any)=>{checkedAlternativeScope(s,row);return config.beforeSend(item);};
 const eligible=(r:any)=>r.scopeExpiresAt===s.expiresAt||s.continuation&&r.scopeExpiresAt===s.continuation.priorExpiresAt&&Date.parse(r.finishedAt||r.startedAt)+86400000>Date.now();
 if(source==='health'){
  const previous=(d.shortlist.accessChecks||[]).find(eligible);
  if(previous){await persist('partial','已保存连接检查，未重复调用：'+previous.status);return;}
  if(s.continuation)throw Error('CONTINUATION_REQUIRES_PRIOR_AUTHENTICATION');
  await guard({service:'apollo_access',requestKey:s.id+':health:'+s.expiresAt,reservedCost:0});
  const check:any={scopeExpiresAt:s.expiresAt,startedAt:new Date().toISOString(),status:'pending',creditsUpperBound:0};(d.shortlist.accessChecks||=[]).push(check);await checkpoint();
  try{
   const response=await fetcher('https://api.apollo.io/api/v1/auth/health',{method:'GET',headers:{'x-api-key':key,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
   check.httpStatus=response.status;const body=await response.json();check.authenticated=body.is_logged_in===true||body.is_api_key===true;
   check.status=response.ok?'done':'failed';check.responseHash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
   check.message=response.ok&&check.authenticated?'密钥通过连接检查；企业搜索资格仍需查询验证':'Apollo未确认密钥访问；停止该入口';
  }catch{check.status='unknown';check.message='连接检查结果未知，不重复请求';}
  check.finishedAt=new Date().toISOString();d.shortlist.message=check.message;d.shortlist.next=null;d.shortlist.revision++;await persist(check.status==='done'?'partial':'blocked',check.message);return;
 }
 const health=(d.shortlist.accessChecks||[]).findLast((r:any)=>r.status==='done'&&r.authenticated&&eligible(r));
 if(!health||d.shortlist.apolloDenied)throw Error(d.shortlist.apolloDenied||'请先通过Apollo连接检查');
 const e=currentEntities(d).find((e:any)=>e.id===config.targetEntityId);if(!e)throw Error('CURRENT_TARGET_ENTITY_REQUIRED');
 const previous=(e.resolutionHistory||[]).concat(e.resolution||[]).find((r:any)=>r.provider==='apollo');
 const proof=d.requests.filter((q:any)=>q.service==='apollo'&&q.requestBody?.q_organization_name===e.name).at(-1);
 const recoverable=s.continuation&&proof?.status==='blocked_before_send'&&proof.reservedCredits===0&&!proof.httpStatus&&!proof.response&&s.continuation.preflightKeys.includes(proof.key);
 if(previous||e.resolutionAttempt?.provider==='apollo'&&!recoverable){await persist('partial','该企业已有Apollo记录，原结果保留，不重复购买');return;}
 if(s.continuation&&!recoverable)throw Error('ONLY_APPROVED_PREFLIGHT_RECOVERY');
 const call=transport({...d,project:{...d.project,maxApolloCredits:3}},{...config,live:true,beforeSend:guard,costUpperBound:{apollo:0}},checkpoint,fetcher);
 if(e.resolutionAttempt)(e.resolutionAttemptHistory||=[]).push(structuredClone(e.resolutionAttempt));
 e.resolutionAttempt={provider:'apollo',query:e.name,status:'pending',startedAt:new Date().toISOString(),...(recoverable?{resumesRequestId:proof.id}:{})};await checkpoint();
 try{
  const hits=await locateOrganizations(call,e);
  if(e.resolution)(e.resolutionHistory||=[]).push(structuredClone(e.resolution));
  e.resolution={provider:'apollo',plan:'apollo-name-v1',query:e.name,purpose:'organization_resolution',status:'done',hits,completedAt:new Date().toISOString()};
  delete e.resolutionAttempt;e.siteCandidates=hits;e.website=hits[0]?.url||'';
  for(const h of hits){(e.officialCandidates||=[]).push({url:h.url,sourceId:h.sourceId,quote:h.declaredName+' website '+h.url,provenance:'apollo_declared_company_site'});}
  e.status=e.website?'Apollo提供企业网站，身份与当地经营待官网核实':'Apollo没有匹配公司网站，完整响应保留';call.commit();
  d.shortlist.message=e.status;d.shortlist.next=null;d.shortlist.revision++;await persist('partial',e.status);
 }catch(error){
  const q=d.requests.filter((r:any)=>r.service==='apollo').at(-1);e.resolutionAttempt.status=q?.status||'failed';
  if([401,403].includes(q?.httpStatus))d.shortlist.apolloDenied=String(q.providerError||(error as Error).message).slice(0,500);
  await persist('blocked',(error as Error).message+'；该来源已停止，原响应与预占保留');
 }
}
