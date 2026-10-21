import {httpUrl} from './schema.mjs';
import {host} from './core.mjs';
import {ProviderError} from './http.mjs';
import {exclusionDomains} from './search-capabilities.mjs';

export async function langsearch(call,query,domains=[],count=50,maxCharacters,includeDomains=[]){
  if(!query?.trim()||!Number.isInteger(count)||count<1||count>50)throw Error('LANGSEARCH_INVALID_INPUT');
  const exclude=exclusionDomains('langsearch',domains);
  const include=exclusionDomains('langsearch',includeDomains);
  if(include.some(d=>exclude.some(x=>d===x||d.endsWith('.'+x)||x.endsWith('.'+d))))throw Error('LANGSEARCH_DOMAIN_FILTER_CONFLICT');
  const raw=await call('langsearch','/v1/web-search',{query:query.trim(),count,freshness:'noLimit',
    ...(maxCharacters?{contents:{text:{maxCharacters}}}:{}),
    ...(exclude.length?{excludeDomains:exclude}:{}),...(include.length?{includeDomains:include}:{})});
  if(String(raw.code)!=='200'||!Array.isArray(raw.data?.webPages?.value)||raw.data.webPages.value.length>count){
    throw new ProviderError('LangSearch 响应异常；原始响应已保留','待核实');
  }
  if(typeof raw.data.queryContext?.originalQuery==='string'&&raw.data.queryContext.originalQuery!==query.trim()){
    throw new ProviderError('QUERY_MISMATCH：供应商返回的原查询与本次请求不一致；原响应已保留','待核实');
  }
  if(raw.data.webPages.value.some(r=>{try{const h=host(r.url);return exclude.some(d=>h===d||h.endsWith('.'+d));}catch{return false;}})){
    throw new ProviderError('EXCLUSION_VIOLATION：LangSearch 返回已排除域名','待核实');
  }
  if(include.length&&raw.data.webPages.value.some(r=>{try{const h=host(r.url);return !include.some(d=>h===d||h.endsWith('.'+d));}catch{return false;}})){
    throw new ProviderError('INCLUSION_VIOLATION：LangSearch 返回限定域名之外的结果','待核实');
  }
  return raw.data.webPages.value.flatMap(r=>{
    try{return [{title:String(r.name||''),siteName:String(r.siteName||''),url:httpUrl(r.url),
      snippet:String(r.snippet||r.text||''),date:r.datePublished||null}];}catch{return [];}
  });
}
