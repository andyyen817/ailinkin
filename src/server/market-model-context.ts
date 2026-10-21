import {marketKey,mentionedMarkets} from '@/domain/target-markets';
import type {MarketSource} from '@/domain/market-research';
export function rankMarketSources(market:string,sources:MarketSource[],detailed=false,queries:string[]=[]){
  const words=queries.map(q=>[...new Set(q.toLowerCase().match(/[a-z][a-z+]{2,}/g)||[])]),common=new Set(words[0]?.filter(w=>words.every(q=>q.includes(w)))||[]);
  const terms=words.map(q=>q.filter(w=>!common.has(w)&&!['company','supplier','distributor','official','website','commercial'].includes(w)));
  const queryFit=(s:MarketSource)=>{const text=(s.title+' '+s.text).toLowerCase();return Math.max(0,...terms.map(q=>q.length?q.filter(w=>text.includes(w)).length/q.length:0));};
  const hostFit=(s:MarketSource)=>{try{return s.url?Number(new URL(s.url).hostname.split(/[.-]/).some(h=>terms.flat().includes(h))):0;}catch{return 0;}};
  const score=(s:MarketSource)=>detailed?hostFit(s)*8+queryFit(s)*12+Number(mentionedMarkets(s.title+' '+s.text,market).length>0)*3+Number(['body','provider_text'].includes(s.evidenceType||'')):0;
  return {sources:[...sources].sort((a,b)=>Number(b.kind==='enterprise')-Number(a.kind==='enterprise')||score(b)-score(a)||Date.parse(b.retrievedAt)-Date.parse(a.retrievedAt)),queryTerms:terms};
}
export function marketModelContext(market:string,sources:MarketSource[],maxBytes=150000,detailed=false,queries:string[]=[]){
  const relevant=sources.filter(s=>s.kind==='enterprise'||marketKey(s.market)===marketKey(market));
  const {sources:ordered,queryTerms:terms}=rankMarketSources(market,relevant,detailed,queries);
  const selected:MarketSource[]=[],omitted:string[]=[],truncated:string[]=[],seen=new Set<string>();
  for(const source of ordered){
    if(seen.has(source.id)){omitted.push(source.id);continue;}seen.add(source.id);
    const limit=detailed&&(source.kind!=='search'||['body','provider_text'].includes(source.evidenceType||''))?6000:1600;
    const text=source.kind==='enterprise'?source.text:evidenceExcerpt(source.text,limit,detailed?queries:[]),copy={...source,text};
    if(selected.length>=80||Buffer.byteLength(JSON.stringify({market,sources:[...selected,copy]}),'utf8')>maxBytes){
      if(source.kind==='enterprise')throw Error('MARKET_ENTERPRISE_CONTEXT_TOO_LARGE');omitted.push(source.id);continue;
    }
    selected.push(copy);if(text!==source.text)truncated.push(source.id);
  }
  return {sources:selected,coverage:{relevantSources:relevant.length,selectedSources:selected.length,omittedSourceIds:omitted,truncatedSourceIds:truncated,queryTerms:terms,
    modelBytes:Buffer.byteLength(JSON.stringify({market,sources:selected}),'utf8'),rawSourcesRetained:true}};
}
export function evidenceExcerpt(text:string,limit:number,queries:string[]=[]){
  if(text.length<=limit||!queries.length)return text.slice(0,limit);
  const terms=[...new Set(queries.join(' ').toLowerCase().match(/[a-z+]{4,}/g)||[])];
  const chunks=Array.from({length:Math.ceil(text.length/500)},(_,i)=>({start:i*500,text:text.slice(i*500,(i+1)*500)}));
  const score=(s:string)=>terms.filter(t=>s.toLowerCase().includes(t)).length;
  const selected=[chunks[0]],ranked=chunks.slice(1).sort((a,b)=>score(b.text)-score(a.text)||a.start-b.start);
  for(const chunk of ranked){if(selected.reduce((n,c)=>n+c.text.length,0)+chunk.text.length+selected.length*7>limit)continue;selected.push(chunk);}
  return selected.sort((a,b)=>a.start-b.start).map(c=>c.text).join('\n[…]\n');
}
