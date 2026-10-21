import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { hash } from './core.mjs';
import { httpUrl, id } from './schema.mjs';
import {providerBilling} from './provider-billing.mjs';
import {auditedRequest,observedModelUsage} from './request-audit.mjs';

export const services = {
  bocha: ['https://api.bocha.cn', 'BOCHA_API_KEY'],
  search: ['https://api.tavily.com', 'TAVILY_API_KEY'],
  langsearch: ['https://api.langsearch.com', 'LANGSEARCH_API_KEY'],
  scrape: ['https://api.firecrawl.dev', 'FIRECRAWL_API_KEY'],
  apollo: ['https://api.apollo.io', 'APOLLO_API_KEY'],
  maps: ['https://places.googleapis.com', 'GOOGLE_MAPS_API_KEY'],
  ai: ['https://api.deepseek.com', 'DEEPSEEK_API_KEY'],
};
export function publicIP(ip) {
  if (isIP(ip) === 6) return /^[23]/i.test(ip) && !ip.toLowerCase().startsWith('2001:db8:');
  if (isIP(ip) !== 4) return false;
  const [a,b]=ip.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || a===169&&b===254 || a===172&&b>=16&&b<=31 || a===192&&(b===168||b===0) || a===100&&b>=64&&b<=127 || a===198&&(b===18||b===19));
}
export async function publicUrl(value, resolve = lookup) {
  const u = new URL(httpUrl(value));
  if (u.port && !['80','443'].includes(u.port)) throw new Error('拒绝非公开网页端口');
  if (!u.hostname.includes('.') || /\.(localhost|local|internal)$/i.test(u.hostname)) throw new Error('拒绝本地地址');
  const addresses = isIP(u.hostname) ? [{address:u.hostname}] : await resolve(u.hostname,{all:true});
  if (!addresses.length || addresses.some(a=>!publicIP(a.address))) throw new Error('拒绝私有或保留网络地址');
  return u.href;
}
export class ProviderError extends Error {
  constructor(message, status = '待重试', retryAt) { super(message); this.status=status; this.retryAt=retryAt; }
}
export function transport(data, config, checkpoint, fetcher = fetch) {
  const acknowledgements=new Set();
  const request = async function(service, route, body, extra = {}) {
    const spec = services[service], key = spec && config.keys?.[spec[1]];
    if (!spec || !key) throw new ProviderError('缺少 '+(spec?.[1] || service), '访问受限／未接入');
    const endpoint = new URL(route, spec[0]);
    if (endpoint.origin !== spec[0] || endpoint.protocol !== 'https:') throw new ProviderError('拒绝非指定供应商地址','访问受限／未接入');
    const auditBody=auditedRequest(body);
    const requestKey = hash(JSON.stringify([service, endpoint.href, auditBody, auditedRequest(extra)]));
    const previous = data.requests.filter(r=>r.key===requestKey).at(-1)||await config.lookupRequest?.(requestKey);
    if (previous?.status==='done' && (!previous.applied || Date.parse(previous.expiresAt)>Date.now())) {
      if(previous.externalCache){data.cacheHits=(data.cacheHits||0)+1;await checkpoint();}
      else acknowledgements.add(previous);
      return previous.response;
    }
    if (previous && ['pending','unknown'].includes(previous.status)) throw new ProviderError('前次外部请求结果未知，需核对后恢复','待核实');
    const cooldown = data.requests.filter(r=>r.service===service && Date.parse(r.retryAt)>Date.now()).at(-1);
    if (cooldown) throw new ProviderError('供应商限流等待中','待重试',cooldown.retryAt);
    const bound = config.endpointCostUpperBound?.[service]?.[route]??config.costUpperBound?.[service];
    if (!config.live || !Number.isFinite(bound) || bound<0) throw new ProviderError('尚未配置真实调用及单次费用上限','访问受限／未接入');
    const spent = data.requests.reduce((n,r)=>n+r.reservedCost,0);
    if (data.requests.length>=data.project.maxRequests || Number((spent+bound).toFixed(8))>data.project.maxSpendUsd) throw new ProviderError('请求或费用上限已到，保留进度','访问受限／未接入');
    const companySearch=service==='apollo'&&route==='/api/v1/mixed_companies/search';
    const billing=providerBilling(service,route,body),reservedCredits=billing.upperBound;
    if(reservedCredits&&(!Number.isInteger(data.project.maxApolloCredits)||data.project.maxApolloCredits<1||data.requests.reduce((n,r)=>n+(r.reservedCredits||0),0)+reservedCredits>data.project.maxApolloCredits))throw new ProviderError('本任务 Apollo 积分上限已到，已保存结果。','访问受限／未接入');
    await config.beforeSend?.({service,requestKey,reservedCost:bound});
    const item = {id:id('Q'),key:requestKey,service,status:'pending',reservedCost:bound,measuredCost:null,startedAt:new Date().toISOString()};
    item.stages=[{stage:'budget_reserved',at:item.startedAt}];
    Object.assign(item,{route,requestBody:auditBody,providerUnit:billing.unit,reservedCredits,measuredCredits:null});
    if(billing.enrichmentPeople)item.enrichmentPeople=billing.enrichmentPeople;
    data.requests.push(item); await checkpoint();
    const authentication = service==='apollo' ? {'x-api-key':key} : service==='maps' ? {'X-Goog-Api-Key':key} : {Authorization:'Bearer '+key};
    const stage=async(name)=>{item.stages.push({stage:name,at:new Date().toISOString()});await checkpoint();};
    let response;
    try {
      await stage('send_started');
      response = await fetcher(endpoint.href,{method:'POST',headers:{...authentication,'Content-Type':'application/json',...extra},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(45000)});
    } catch {
      item.status='unknown'; await checkpoint();
      throw new ProviderError('网络中断，请求是否受理未知，请先核对','待核实');
    }
    item.httpStatus=response.status;
    await stage('http_received');
    if (!response.ok) {
      item.status=response.status>=500 ? 'unknown' : 'failed';
      const after=response.headers.get('retry-after');
      item.retryAt=response.status===429 ? new Date(Math.max(Date.now()+1000, /^\d+$/.test(after || '') ? Date.now()+Number(after)*1000 : Date.parse(after) || Date.now()+60000)).toISOString() : null;
      if(companySearch){
        try{const error=await response.json();item.providerError=String(error.error||error.message||'').replaceAll(key,'[REDACTED]').slice(0,500);}catch{}
      }
      await checkpoint();
      const hint=companySearch&&response.status===403?'，Apollo 拒绝当前密钥或套餐访问企业搜索。':companySearch&&response.status===401?'，Apollo 密钥未通过认证。':'';
      throw new ProviderError('供应商返回 HTTP '+response.status+hint, item.status==='unknown' ? '待核实' : [401,403].includes(response.status) ? '访问受限／未接入' : '待重试',item.retryAt);
    }
    try {
      const raw=await response.text();
      if (raw.length>4000000) throw new Error('响应过大');
      item.rawResponse=raw;await stage('body_received');
      item.response=JSON.parse(raw);
      await stage('structured');
      if(service==='ai')item.usage=observedModelUsage(item.response);
      if(service==='langsearch'){
        const usage=item.response.usage;
        if(usage&&Number.isFinite(usage.input_tokens)&&Number.isFinite(usage.output_tokens)){
          item.usage={inputTokens:usage.input_tokens,outputTokens:usage.output_tokens};
        }
      }
      if (service==='bocha' && String(item.response.code)==='200' && !Array.isArray(item.response.data?.webPages?.value)) throw new Error('搜索结果结构异常');
      item.status='done';
      item.expiresAt=new Date(Date.now()+(config.cacheSeconds?.[service] || 0)*1000).toISOString();
    } catch { item.status='unknown'; await checkpoint(); throw new ProviderError('响应未能解析，请核对供应商结果','待核实'); }
    if (['bocha','langsearch'].includes(service) && String(item.response.code)!=='200') {
      const code=Number(item.response.code), logId=String(item.response.log_id || '').replace(/[^\w-]/g,'').slice(0,128);
      item.status=Number.isFinite(code)&&code>=400&&code<500?'failed':'unknown';
      item.providerCode=Number.isFinite(code)?code:null; item.logId=logId; delete item.response;
      if(code===429)item.retryAt=new Date(Date.now()+60000).toISOString();
      await checkpoint();
      throw new ProviderError((service==='bocha'?'博查':'LangSearch')+'业务错误 '+(item.providerCode??'未知')+(logId?'，查询编号 '+logId:''),item.status==='unknown'?'待核实':code===429?'待重试':'访问受限／未接入',item.retryAt);
    }
    await checkpoint();
    acknowledgements.add(item); return item.response;
  };
  request.commit=()=>{ for (const item of acknowledgements) item.applied=true; acknowledgements.clear(); };
  return request;
}
