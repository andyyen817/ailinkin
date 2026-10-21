const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function referenceSite(url){
  try{const u=new URL(url),d=u.hostname.replace(/^www\./,'');return /(^|\.)(wikipedia\.org|blogspot\.com|wordpress\.com|leadiq\.com|stockanalysis\.com|qraved\.com|simplywall\.st|usarestaurants\.info|adobomagazine\.com|bworldonline\.com|fintechnews\.sg|tmcblog\.com|phoenixnewtimes\.com|lasvegasweekly\.com|katalogpromosi\.com|skincarisma\.com|spanishdict\.com|rappler\.com|asiaone\.com)$/.test(d);}catch{return false;}
}
export function pointerSources(data,e){
  const names=[normalize(e.name),normalize(e.name.replace(/\s+(company|group|inc|holdings)$/i,''))];
  const sources=[...(e.locatorReferences||[]),...(e.resolution?.hits||[]),...(e.evidence||[]).map(c=>{const p=data.sourcePages?.find(p=>p.id===c.sourceId);return {url:c.url,title:p?.title||'',snippet:p?.text||c.quote};})];
  const seen=new Set();return sources.filter(p=>referenceSite(p.url)&&names.some(n=>n.length>=5&&normalize(p.title+' '+p.snippet).includes(n))).filter(p=>{if(seen.has(p.url))return false;seen.add(p.url);return true;})
    .sort((a,b)=>Number(/wikipedia|stockanalysis/.test(new URL(b.url).hostname))-Number(/wikipedia|stockanalysis/.test(new URL(a.url).hostname))).slice(0,1);
}
export function explicitSitePointers(e,page){
  const name=normalize(e.name.replace(/\s+(company|group|inc|holdings)$/i,''));
  if(name.length<5||!normalize(page.content).includes(name))return [];
  const websiteText=page.content.match(/(?:Website|Official website|Situs)\s+.{0,180}/gi)||[];
  const observed=(page.links||[]).flatMap(url=>{
    try{const d=normalize(new URL(url).hostname.replace(/^www\./,''));
      return websiteText.some(t=>normalize(t).includes(d))?[{url,label:'Website (observed href and visible website text)'}]:[];
    }catch{return [];}
  });
  const seen=new Set();
  return [...(page.linkDetails||[]),...observed].flatMap(link=>{
    try{const u=new URL(link.url),source=new URL(page.url);
      if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.origin===source.origin||referenceSite(u.href))return [];
      if(!/\b(website|official|situs|visit site)\b|^www\./i.test(link.label.trim()))return [];
      if(/facebook|instagram|linkedin|youtube|reddit|twitter|tiktok|\/share\b/i.test(u.hostname))return [];
      u.hash='';if(seen.has(u.href))return [];seen.add(u.href);return [{url:u.href,sourceId:'public-link:'+e.id,observedFromUrl:page.url,linkLabel:link.label,status:'来源明示官网链接，归属待核实'}];
    }catch{return [];}
  }).slice(0,2);
}
