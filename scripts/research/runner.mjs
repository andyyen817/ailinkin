import { assertProject, domains, id, platformsFor } from './schema.mjs';
import { upsertCompany, host, hash } from './core.mjs';
import { beginAttempt, finishAttempt, latest } from './state.mjs';
import { officialLinks,profileBelongsToCompany } from './providers.mjs';
import {webCandidate,discoveryQuery} from './web-discovery.mjs';
import {scopeVersion} from './qualification.mjs';
import {enrichSelected} from './contact-enrichment.mjs';
import {coverageQueryOrder,executionLimit,discoveryStop} from './discovery-policy.mjs';

const expires = days => new Date(Date.now()+days*86400000).toISOString();
export async function discover(data, api, checkpoint) {
  assertProject(data.project);
  const queries=coverageQueryOrder(data,k=>discoveryQuery(k,data.project));
  if(discoveryStop(data))return;
  for (const keyword of queries) for (const source of api.discoverySources || ['Google Maps','网页搜索']) {
    if (data.companies.filter(c=>!c.sourceOnly).length>=executionLimit(data)) return;
    const query=discoveryQuery(keyword,data.project);
    const exclusions=data.project.discoveryMode==='exclude_rounds'?[...new Set([...(data.project.excludedDomains||[]),...data.companies.filter(c=>!c.sharedDomain&&c.organizationType!=='store'&&c.website).map(c=>host(c.website))])].sort():null;
    const key=hash(JSON.stringify([source,query,source==='网页搜索'?(api.searchProvider||'tavily'):'maps',...(exclusions?[exclusions]:[])]));
    let b=data.batches.find(x=>x.id===key);
    if (b?.status==='已完成' && Date.parse(b.expiresAt)>Date.now()) continue;
    if (b?.status==='访问受限／未接入' || b?.status==='待核实') continue;
    b ||= {id:key,batchId:id('B'),country:data.project.country,city:data.project.city,query,keyword,source,provider:api.searchProvider,count:0,added:0,duplicates:0,excluded:[],excludedDomains:exclusions||[]};
    if (!data.batches.includes(b)) data.batches.push(b);
    b.status='检索中'; b.startedAt=new Date().toISOString(); await checkpoint();
    try {
      do {
      const found=b.remaining?.length ? {results:b.remaining,cursor:b.cursor} : source==='Google Maps' ? await api.maps(query,b.cursor) : {results:await api.search(query)};
      b.remaining=[...found.results]; b.cursor=found.cursor || null;
      while (b.remaining.length && data.companies.length<executionLimit(data)) {
        const hit=b.remaining.shift();
        const result=source==='网页搜索'?webCandidate(data,hit,query,api.searchProvider||'tavily'):upsertCompany(data,{name:hit.name || hit.title,country:data.project.buyerGroup?'未知':data.project.country,city:data.project.buyerGroup?'':data.project.city,website:hit.website || hit.url,source:hit.mapUrl || hit.url,product:'',buyerType:''});
        if(result.excluded){b.count++;(b.excluded ||= []).push(result);continue;}
        if (result.added) result.company.status='待核实';
        b.count++; b[result.added?'added':'duplicates']++;
      }
      b.status=b.cursor || b.remaining.length ? '待续—仍有分页' : '已完成';
      b.finishedAt=new Date().toISOString(); b.expiresAt=expires(14);
      api.commit?.();
      await checkpoint();
      } while (b.cursor && data.companies.length<executionLimit(data));
    } catch (e) { b.status=e.status || '待重试'; b.error=e.message; }
    api.commit?.(); await checkpoint();
    if(data.project.discoveryPolicy?.mode==='coverage'){coverageQueryOrder(data,k=>discoveryQuery(k,data.project));return;}
  }
}
export async function research(data, api, checkpoint, { contacts = true, platforms = platformsFor(data.project) } = {}) {
  assertProject(data.project);
  const scope=scopeVersion(data.project);
  for (const c of data.companies.filter(c=>c.status!=='已排除'&&!(c.qualification?.status==='unfit'&&
    c.qualification.scopeKey===scope.scopeKey&&c.qualification.analysisVersion===scope.analysisVersion))) {
    c.researchQuestions=data.project.buyerGroup?.searchSpecs?.flatMap(s=>s.verify||[])||[];
    const old=latest(data,c.id,'网页');
    let links=old?.links || {};
    for (const platform of ['网页',...platforms.filter(x=>x!=='网页')]) {
      const query=platform==='网页' ? c.website || c.name+' '+c.country : 'site:'+domains[platform]+' "'+c.name+'" "'+(c.website ? host(c.website) : c.country)+'"';
      const a=beginAttempt(data,c.id,platform,query);
      if (!a) continue;
      await checkpoint();
      try {
        const approved=c.approvedProfiles?.[platform];
        let url=approved?.url || (platform==='网页' ? c.website : links[platform]);
        if (!url) {
          const found=await api.search(query);
          const alternatives=found.length ? [] : await api.search('"'+c.name+'" '+c.country+(domains[platform]?' site:'+domains[platform]:''));
          const result=found[0] || alternatives[0];
          finishAttempt(a,result ? {status:'待核实',url:result.url,error:'找到候选页面，需要确认企业归属'} : {status:'已完成—未发现',queryFinished:true,expiresAt:expires(14)});
        } else {
          a.url=url; a.stage='内容研究'; await checkpoint();
          const page=await api.read(url,platform);
          if (!approved && (platform==='网页'?(c.name.length<4||!page.content.toLowerCase().includes(c.name.toLowerCase())):!profileBelongsToCompany(page,c.website,c.name))) {
            finishAttempt(a,{status:'待核实',url,error:'正文未能确认公司名称，保留资料待核对',summary:page.content.slice(0,2000),evidence:[{url,quote:page.content.slice(0,4000)}]});
          } else {
            finishAttempt(a,{status:'已完成—有资料',queryFinished:true,expiresAt:expires(30),url,readScope:page.readScope||'public_page',identity:approved?'人工核实：'+approved.identity:platform==='网页'?'名单域名对应页面，正文包含公司名':'官网与社媒互相链接且正文包含企业名称',summary:page.content.slice(0,2000),evidence:[{url,quote:page.content.slice(0,12000)}]});
            if (platform==='网页') { links=officialLinks(c.website,page); a.links=links; }
          }
        }
      } catch (e) {
        finishAttempt(a,{status:e.status || '待重试',url:a.url,error:e.message,retryAt:e.retryAt || expires(1/1440)});
      }
      api.commit?.(); await checkpoint();
    }
    const fitReady=!data.project.buyerGroup||(c.qualification?.status==='qualified'&&c.qualification.scopeKey===scope.scopeKey&&c.qualification.analysisVersion===scope.analysisVersion);
    if (contacts && fitReady && c.website && latest(data,c.id,'网页')?.status==='已完成—有资料' && !(Date.parse(c.apolloExpiresAt)>Date.now())) {
      try {
        if(data.project.buyerGroup){await enrichSelected(data,c,api,checkpoint);continue;}
        const people=await api.people(c.website);
        for (const person of people.slice(0,2)) {
          if (data.contacts.some(x=>x.companyId===c.id && x.apolloId===person.id)) continue;
          const full=await api.enrich(person);
          if (!full.employerDomain || host('https://'+full.employerDomain)!==host(c.website)) continue;
          data.contacts.push({...full,id:id('P'),companyId:c.id,updatedAt:new Date().toISOString(),suppressed:false});
          api.commit?.(); await checkpoint();
        }
        c.apolloStatus=people.length?'已查询':'未发现'; c.apolloExpiresAt=expires(30);
      } catch(e) { c.apolloStatus=e.status || '待重试'; c.apolloError=e.message; }
      api.commit?.(); await checkpoint();
    }
  }
}
