export const searchCapabilities=Object.freeze({
  bocha:{nativeExclusions:true,exclusionLimit:100,resultLimit:50},
  langsearch:{nativeExclusions:true,exclusionLimit:null,resultLimit:50},
  apollo:{nativeExclusions:true,exclusionLimit:null,resultLimit:100},
  tavily:{nativeExclusions:false,exclusionLimit:0,resultLimit:10},
  maps:{nativeExclusions:false,exclusionLimit:0,resultLimit:20},
});
export function mainlandMarket(value){
  return /^(中国大陆|大陆|中国|中国内地|Mainland China|China)$/i.test(String(value).trim());
}
export function webProviderFor(country,keys){
  if(mainlandMarket(country)&&keys.BOCHA_API_KEY)return 'bocha';
  if(keys.LANGSEARCH_API_KEY)return 'langsearch';
  if(keys.TAVILY_API_KEY)return 'tavily';
  return mainlandMarket(country)?'bocha':'langsearch';
}
export function exclusionDomains(provider,domains){
  const cap=searchCapabilities[provider];if(!cap)throw Error('SEARCH_PROVIDER_UNAVAILABLE');
  const result=[...new Set(domains.map(d=>String(d).toLowerCase().replace(/^www\./,'')))].sort();
  if(result.some(d=>!d.includes('.')||/[\s/|,:@]/.test(d)))throw Error('INVALID_EXCLUSION_DOMAIN');
  if(result.length&&!cap.nativeExclusions)throw Error('NATIVE_EXCLUSION_UNVERIFIED');
  // null means no documented cap. It does not mean unlimited account entitlement.
  if(cap.exclusionLimit!==null&&result.length>cap.exclusionLimit)throw Error('EXCLUSION_CAPACITY_REQUIRES_REVIEW');
  return result;
}
