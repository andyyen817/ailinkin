import {httpUrl} from './schema.mjs';
import {hash} from './core.mjs';
export const pageFresh=p=>Date.parse(p?.retrievedAt||'')+86400000>Date.now();
export const pageUrl=s=>{try{return httpUrl(s);}catch{return null;}};
export function observedBuyerLinks(page){
  const home=new URL(page.url),seen=new Set([pageUrl(page.url)]),links=[];
  for(const value of page.linkDetails||page.links||[]){
    try{
      const u=new URL(typeof value==='string'?value:value.url);u.hash='';
      if(u.origin!==home.origin||seen.has(pageUrl(u.href))||/\.(pdf|jpg|png|svg|zip)$/i.test(u.pathname))continue;
      const label=(typeof value==='string'?'':value.label)+' '+u.pathname;
      const priority=/about|tentang|company|corporate|profile|profil/i.test(label)?3:
        /store|location|outlet|branch|lokasi|contact|hubungi/i.test(label)?2:
        /menu|franchise|business|waralaba/i.test(label)?1:0;
      if(!priority)continue;seen.add(pageUrl(u.href));links.push({url:u.href,priority});
    }catch{}
  }
  return links.sort((a,b)=>b.priority-a.priority).slice(0,2).map(x=>x.url);
}
export function buyerPages(entity){
  const root=pageUrl(entity.website);if(!root)return [];
  const origin=new URL(root).origin,seen=new Set(),pages=[];
  for(const p of [...(entity.websitePages||[])].reverse()){
    if(!p.content||!pageFresh(p)||!pageUrl(p.url)||new URL(p.url).origin!==origin||seen.has(pageUrl(p.url)))continue;
    seen.add(pageUrl(p.url));pages.push(p);
  }
  return pages.sort((a,b)=>Number(pageUrl(b.url)===root)-Number(pageUrl(a.url)===root)).slice(0,4);
}
export const pageEvidenceId=(entity,page)=>pageUrl(page.url)===pageUrl(entity.website)?'web:'+entity.id:'web:'+entity.id+':'+hash(page.url).slice(0,12);
export const visibleBuyerText=p=>p.content.slice(0,6000).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email omitted]');
export function observedMarketLinks(entity){
 const origin=pageUrl(entity.website)&&new URL(entity.website).origin;if(!origin)return [];
 const links=(entity.websitePages||[]).filter(p=>p.content).flatMap(p=>p.linkDetails||[]);
 return [...new Set(links.filter(l=>{try{return new URL(l.url).origin===origin&&/store|location|outlet|branch|lokasi/i.test(l.label+' '+new URL(l.url).pathname);}catch{return false;}}).map(l=>pageUrl(l.url)).filter(Boolean))].slice(0,3);
}
