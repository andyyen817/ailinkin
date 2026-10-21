import 'server-only';
import {publicContactLink} from '../../scripts/research/public-contact-links.mjs';
export const traceNorm=(v:string)=>String(v||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const quote=(v:string)=>'"'+String(v||'').replace(/["\r\n]/g,' ').slice(0,120)+'"';
export function traceSearchQueries(p:any){
  const aliases=[...new Set([p.name,...p.traceAliases||[]])].filter(Boolean).slice(0,4);
  let handle='';try{handle=decodeURIComponent(new URL(p.profileUrl).pathname.split('/').filter(Boolean).at(-1)||'');}catch{}
  const name=aliases.map(quote).join(' '),work=quote(p.companyName);
  return [name+' '+work,quote(p.name)+' '+work+' filetype:pdf'];
}
export function traceUrl(raw:string,p:any){
  try{const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||/\.(?:zip|exe|jpg|jpeg|png|gif|mp4|mp3)$/i.test(u.pathname))return null;
    if(/(?:^|\.)linkedin\.com$/i.test(u.hostname)&&u.pathname.replace(/\/$/,'')!==new URL(p.profileUrl).pathname.replace(/\/$/,''))return null;
    if(/(?:^|\.)(?:prospeo\.io|hunter\.io)$/i.test(u.hostname)||['wa.me','api.whatsapp.com'].includes(u.hostname))return null;
    u.hash='';for(const key of [...u.searchParams.keys()])if(/^(?:utm_|fbclid|gclid)/.test(key))u.searchParams.delete(key);
    return u.href;
  }catch{return null;}
}
export function tracePageIdentity(p:any,page:any){
  const text=String(page.personText||''),names=[p.name,...p.traceAliases||[]].map(traceNorm),normalized=traceNorm(text),heading=traceNorm(page.heading||'');
  const named=names.some(n=>n&&normalized.includes(n)),employer=normalized.includes(traceNorm(p.companyName));
  const personalHeading=names.some(n=>n&&heading.includes(n)&&heading.length<n.length+60);
  const profile=traceUrl(p.profileUrl,p),ownLink=!!profile&&(page.links||[]).some((l:any)=>traceUrl(l.url,p)===profile);
  let official=false,ownProfile=false;try{const u=new URL(page.url);official=u.hostname.replace(/^www\./,'')===p.domain;ownProfile=traceUrl(page.url,p)===traceUrl(p.profileUrl,p);}catch{}
  return {named,employer,personalHeading,ownLink,official,ownProfile,confirmed:!!(named&&((official&&personalHeading)||(ownLink&&personalHeading)||(ownProfile&&employer)))};
}
export function traceFrontier(p:any,receipts:any[]){
  const candidates:any[]=[{url:p.profileUrl,via:'LinkedIn公开资料'},...(p.traceSeeds||[]).map((url:string)=>({url,via:'运营补充的公开线索，待核实'}))];
  const searches=receipts.filter(r=>r.kind==='public_search'&&r.personKey===p.personKey&&r.state==='done');
  let handle='';try{handle=new URL(p.profileUrl).pathname.split('/').filter(Boolean).at(-1)||'';}catch{}
  const clues=[p.name,...p.traceAliases||[],...(handle.length>=4?[handle]:[])];
  const results=searches.flatMap(r=>r.result?.results||[]).filter(r=>clues.some(n=>traceNorm([r.title,r.snippet,r.url].join(' ')).includes(traceNorm(n))));
  const rank=(r:any)=>/\.pdf(?:[?#]|$)/i.test(r.url)?0:publicContactLink(r.url)?.kind==='social'?2:1;
  candidates.push(...results.sort((a,b)=>rank(a)-rank(b)).slice(0,4).map(r=>({...r,via:'搜索候选，摘要未确认归属'})));
  for(const receipt of receipts.filter(r=>r.kind==='public_page'&&r.personKey===p.personKey&&r.state==='done'&&r.result?.state==='read')){
    const page=receipt.result,id=tracePageIdentity(p,page);
    if(id.official){
      const navigation=(page.links||[]).filter((l:any)=>{try{return new URL(l.url).hostname.replace(/^www\./,'')===p.domain&&([p.name,...p.traceAliases||[]].some(n=>traceNorm(l.label||'').includes(traceNorm(n)))||/^(?:about(?: us)?|our team|team|leadership|management|people|contact(?: us)?)$/i.test((l.label||'').trim()));}catch{return false;}});
      candidates.unshift(...navigation.slice(0,2).map((l:any)=>({...l,via:'官网人物或团队导航，归属仍待核实',parentUrl:page.url})));
    }
    if(!id.confirmed)continue;
    const links=(page.links||[]).filter((l:any)=>{
      const contact=publicContactLink(l.url);if(contact&&contact.kind!=='social')return false;
      const named=[p.name,...p.traceAliases||[]].some(n=>traceNorm(l.label||'').includes(traceNorm(n)));
      return named||!id.official&&(id.ownLink||id.ownProfile)&&!/(privacy|terms|login|sign.?up|cookie)/i.test(l.label||'');
    });
    candidates.unshift(...links.slice(0,3).map((l:any)=>({...l,via:'人物实名页面的公开外链',parentUrl:page.url})));
  }
  if(p.domain)candidates.push({url:'https://'+p.domain+'/',via:'公司官网兜底'});
  const known=new Map<string,any>();for(const candidate of candidates){const url=traceUrl(candidate.url,p);if(url&&!known.has(url))known.set(url,{...candidate,url});}
  return [...known.values()];
}
