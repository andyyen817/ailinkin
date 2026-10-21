import {publicIP,ProviderError} from './http.mjs';
import {httpUrl} from './schema.mjs';
import {isIP} from 'node:net';
export function publicTarget(raw,addresses){
 const url=new URL(httpUrl(raw));
 if(url.href.length>8192||url.port&&!['80','443'].includes(url.port)||!url.hostname.includes('.')||/\.(local|localhost|internal)$/i.test(url.hostname))throw new ProviderError('拒绝非公开或过长的官网地址','访问受限／未接入');
 const blocked=ip=>!publicIP(ip)||/^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(ip);
 if(!addresses.length||addresses.some(a=>blocked(a.address)))throw new ProviderError('拒绝私有或保留网络地址','访问受限／未接入');
 return {url,addresses:addresses.map(a=>({address:a.address,family:a.family||isIP(a.address)}))};
}
const octets=s=>s.replace(/[^\x00-\x7f]/gu,c=>encodeURIComponent(c)).replace(/%[a-f0-9]{2}/gi,p=>{
 const ch=String.fromCharCode(parseInt(p.slice(1),16));return /[a-z0-9._~-]/i.test(ch)?ch:p.toUpperCase();
});
function pathMatches(pattern,path){
 const exact=pattern.endsWith('$'),p=exact?pattern.slice(0,-1):pattern;
 let i=0,j=0,star=-1,retry=0;
 while(i<path.length){
  if(j===p.length)return !exact;
  if(p[j]==='*'){star=j++;retry=i;}
  else if(p[j]===path[i]){i++;j++;}
  else if(star>=0){j=star+1;i=++retry;}else return false;
 }
 while(p[j]==='*')j++;return j===p.length;
}
export function robotsPolicy(text,url,agent='AilinkinResearch'){
 if(text.includes('\ufffd'))throw new ProviderError('robots规则编码不完整','待核实');
 const groups=[];let group={agents:[],rules:[],delay:0},hasRules=false;
 for(const raw of text.split(/\r?\n/)){
  const line=raw.replace(/#.*$/,'').trim(),match=line.match(/^([^:]+):(.*)$/);if(!match)continue;
  const key=match[1].trim().toLowerCase(),value=match[2].trim();
  if(key==='user-agent'){
   if(hasRules){groups.push(group);group={agents:[],rules:[],delay:0};hasRules=false;}
   group.agents.push(value.toLowerCase());
  }else if(['allow','disallow','crawl-delay'].includes(key)&&group.agents.length){
   hasRules=true;if(key==='crawl-delay'){if(Number.isFinite(Number(value)))group.delay=Math.max(group.delay,Number(value));continue;}
   if(!value)continue;
   group.rules.push({allow:key==='allow',pattern:value.startsWith('/')?octets(value):null});
  }
 }
 groups.push(group);let selected=groups.filter(g=>g.agents.includes(agent.toLowerCase()));
 if(!selected.length)selected=groups.filter(g=>g.agents.includes('*'));
 if(selected.some(g=>g.rules.some(r=>r.pattern===null)))throw new ProviderError('robots适用组路径规则无法确认','待核实');
 const u=new URL(url),path=octets(u.pathname+u.search);
 const matches=selected.flatMap(g=>g.rules).filter(rule=>pathMatches(rule.pattern,path))
  .map(r=>({...r,length:r.pattern.replace(/%[A-F0-9]{2}/g,'x').replace(/[*$]/g,'').length}));
 matches.sort((a,b)=>b.length-a.length||Number(b.allow)-Number(a.allow));
 return {allowed:matches[0]?.allow??true,delay:Math.max(1,...selected.map(g=>g.delay))};
}
