import { publicUrl, ProviderError } from './http.mjs';
import { domains, httpUrl } from './schema.mjs';
import { host } from './core.mjs';
import {langsearch} from './langsearch.mjs';
import {modelJson} from './model-client.mjs';
import {contactPlan} from './contact-planner.mjs';

export function providers(call, config = {}, resolve) {
  let exclusionFailure=false;
  return {
    discoverySources:config.discoverySources,
    searchProvider:config.searchProvider || 'tavily',
    commit:()=>call.commit?.(),
    async search(query,context={}) {
      if(exclusionFailure)throw new ProviderError('EXCLUSION_VIOLATION：已暂停本组请求。','待核实');
      const exclude=config.discoveryExclusions?.(context)||[];
      if(config.searchProvider==='langsearch'){
        try{return await langsearch(call,query,exclude,config.searchResultCount||50,config.searchTextCharacters,context.includeDomains||[]);}
        catch(e){if(e.message.includes('EXCLUSION_VIOLATION'))exclusionFailure=true;throw e;}
      }
      if(config.searchProvider==='bocha') {
        if(exclude.length>100)throw new ProviderError('排除名单超过100个，请细化范围后继续。','待核实');
        const raw=await call('bocha','/v1/web-search',{query,freshness:'noLimit',summary:true,count:50,...(exclude.length?{exclude:exclude.join('|')}:{})});
        if(String(raw.code)!=='200'||!Array.isArray(raw.data?.webPages?.value))throw new ProviderError('博查搜索响应异常','待核实');
        if(raw.data.webPages.value.some(r=>{try{const h=host(r.url);return exclude.some(d=>h===d||h.endsWith('.'+d));}catch{return false;}})){exclusionFailure=true;throw new ProviderError('EXCLUSION_VIOLATION：博查返回了已排除的官网。','待核实');}
        return raw.data.webPages.value.slice(0,50).flatMap(r=>{
          try{return [{title:String(r.name||''),siteName:String(r.siteName||''),url:httpUrl(r.url),snippet:String(r.summary||r.snippet||''),date:r.datePublished||null}];}catch{return [];}
        });
      }
      if(exclude.length)throw new ProviderError('当前网页来源的原生排除尚未验收，已暂停新增请求。','访问受限／未接入');
      const raw=await call('search','/search',{query,max_results:10,search_depth:'basic',include_answer:false,include_raw_content:false});
      if (!Array.isArray(raw.results)) throw new ProviderError('搜索响应缺少结果数组','待核实');
      return raw.results.map(r=>({title:String(r.title || ''),url:httpUrl(r.url),snippet:String(r.content || ''),date:r.published_date || null}));
    },
    async maps(query, cursor) {
      if (!config.mapsDataRights) throw new ProviderError('Maps 数据保存用途尚未确认','访问受限／未接入');
      const raw=await call('maps','/v1/places:searchText',{textQuery:query,pageSize:20,...(cursor?{pageToken:cursor}:{})},{'X-Goog-FieldMask':'places.id,places.displayName,places.websiteUri,places.formattedAddress,places.googleMapsUri,nextPageToken'});
      if (raw.places!==undefined && !Array.isArray(raw.places)) throw new ProviderError('Maps 响应格式异常','待核实');
      return {results:(raw.places || []).map(p=>({name:p.displayName?.text || '',website:p.websiteUri || '',mapId:p.id,mapUrl:p.googleMapsUri,address:p.formattedAddress})),cursor:raw.nextPageToken || null};
    },
    async read(url, platform='网页') {
      const address=await publicUrl(url,resolve);
      if(platform==='网页'&&config.readWebsite)return config.readWebsite(address);
      if (platform!=='网页' && !config.socialReadAllowed?.includes(platform)) throw new ProviderError('已找到入口，'+platform+' 内容读取尚未接入','访问受限／未接入');
      const raw=await call('scrape','/v2/scrape',{url:address,formats:['markdown','links'],onlyMainContent:true,timeout:30000});
      if (raw.success!==true || !raw.data?.markdown?.trim()) throw new ProviderError('未取得正文，不能记录为研究完成','待核实');
      const content=raw.data.markdown.slice(0,24000);
      if (/captcha|access denied|verify you are human|请完成验证/i.test(content.slice(0,600))) throw new ProviderError('页面要求访问验证','访问受限／未接入');
      return {url:address,content,readScope:platform==='网页'?'public_web_page':'public_social_page',links:(raw.data.links || []).filter(x=>/^https?:\/\//i.test(x))};
    },
    async people(website) {
      const body=config.buyerGroup?contactPlan(config.buyerGroup,website).body:{q_organization_domains_list:[host(website)],person_titles:['purchasing','procurement','owner','founder'],page:1,per_page:5};
      const raw=await call('apollo','/api/v1/mixed_people/api_search',body);
      if (!Array.isArray(raw.people)) throw new ProviderError('Apollo 搜索响应异常','待核实');
      return raw.people.map(p=>({id:p.id,name:[p.first_name,p.last_name || p.last_name_obfuscated].filter(Boolean).join(' '),title:p.title || '',organization:p.organization}));
    },
    async enrich(person) {
      if (!person.id) throw new Error('缺少 Apollo 人员 ID');
      const raw=await call('apollo','/api/v1/people/match',{id:person.id,reveal_personal_emails:false,reveal_phone_number:false});
      if (!raw.person) throw new ProviderError('Apollo 未返回人员补全结果','待核实');
      const p=raw.person;
      return {apolloId:p.id,name:p.name || person.name,title:p.title || '',email:p.email || '',emailStatus:p.email_status ? 'Apollo:'+p.email_status+'（待独立核验）' : '未知',phone:p.organization?.phone || '',phoneType:'公司电话',employerDomain:p.organization?.primary_domain || '',employerEvidence:p.organization?.website_url || '',emailSource:'Apollo',phoneSource:'Apollo'};
    },
    async model(messages) {
      return modelJson(call,messages,config.model||'deepseek-chat');
    },
  };
}
export function officialLinks(website, page) {
  if (host(website)!==host(page.url)) return {};
  const found={};
  for (const [platform,domain] of Object.entries(domains)) {
    found[platform]=page.links.find(link=>{try {
      const u=new URL(link),h=host(link);
      return (h===domain||h.endsWith('.'+domain))&&u.pathname!=='/'&&!/\/(share|sharer|search|intent|status|posts?|reels?|watch)(\/|\.php|$)/i.test(u.pathname);
    }catch{return false;}});
  }
  return found;
}
export function profileBelongsToCompany(page,website,name){
  if(!name||name.length<4||!page.content?.toLowerCase().includes(name.toLowerCase()))return false;
  return page.links?.some(link=>{try{return host(link)===host(website);}catch{return false;}})||false;
}
