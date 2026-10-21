import {hash} from './core.mjs';
import {plainTextEmails} from './contact-detail-fields.mjs';
export function accessBarrier(text,status=200){
  if([401,403,429].includes(status))return status===429?'rate_limited':'access_denied';
  const start=String(text).slice(0,2500);
  if(/captcha|verify you are human|access denied|challenge-platform|请完成验证/i.test(start))return 'challenge';
  if(/^(?:\s*)(?:log in|sign in|登录|登入)(?:\s|$)/i.test(start)&&start.length<1200)return 'login_required';
  return null;
}
export function htmlContactText(html,url){
  const links=[];
  const visible=String(html).replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');
  const decode=s=>s.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ');
  for(const m of visible.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{const u=new URL(decode(m[1]),url);if(['https:','http:','mailto:','tel:'].includes(u.protocol)&&!u.username&&!u.password)
      links.push({url:u.href,label:decode(m[2].replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()});}catch{}
  }
  return {text:decode(visible.replace(/<(?:br|\/p|\/div|\/section|\/li)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim(),links};
}
/** @param {{url:string,text:string,links?:Array<string|{url:string,label?:string}>,retrievedAt?:string,companyId?:string,maxCharacters?:number,maxBlocks?:number}} input */
export function contactText({url,text,links=[],retrievedAt=new Date().toISOString(),companyId,maxCharacters=32000,maxBlocks=8}){
  if(!Number.isInteger(maxCharacters)||maxCharacters<1||maxCharacters>64000||!Number.isInteger(maxBlocks)||maxBlocks<1||maxBlocks>16)throw Error('INVALID_TEXT_LIMIT');
  const barrier=accessBarrier(text);if(barrier)return {state:'blocked',reason:barrier,blocks:[],channels:[],coverage:{complete:false,reason:barrier}};
  const raw=String(text),selected=raw.slice(0,maxCharacters),blocks=[];
  for(let offset=0;offset<selected.length&&blocks.length<maxBlocks;offset+=4000){
    const value=selected.slice(offset,offset+4000);blocks.push({id:'TXT-'+hash(JSON.stringify([url,value,offset])).slice(0,24),sourceUrl:url,text:value,
      quote:value,retrievedAt,contentHash:hash(value),start:offset,end:offset+value.length});
  }
  const channels=[],seen=new Set(),allLinks=links.slice(0,1000);
  for(const link of allLinks){
    const value=typeof link==='string'?link:link.url;let kind,channel;
    try{const u=new URL(value);if(u.protocol==='mailto:'){kind='email';channel=decodeURIComponent(u.pathname).split('?')[0];if(!/^[^\s@,;]+@[^\s@]+\.[^\s@]+$/.test(channel))continue;}
      else if(u.protocol==='tel:'){kind='phone';channel=decodeURIComponent(u.pathname);}
      else if(u.protocol==='https:'&&['wa.me','api.whatsapp.com'].includes(u.hostname)){kind='whatsapp';channel=u.hostname==='wa.me'?u.pathname.slice(1):u.searchParams.get('phone');}
      else continue;
    }catch{continue;}
    if(kind!=='email'&&!/^[+()\d][\d\s()+.-]{6,30}$/.test(channel||''))continue;
    const key=kind+':'+channel;if(seen.has(key))continue;seen.add(key);
    channels.push({companyId,kind,value:channel,scope:'company',verification:'unverified',evidence:[{id:'LINK-'+hash(JSON.stringify([url,value])).slice(0,24),sourceUrl:url,quote:value,retrievedAt,contentHash:hash(value)}]});
  }
  for(const channel of plainTextEmails(blocks))if(!seen.has('email:'+channel.value)){channels.push({...channel,companyId});seen.add('email:'+channel.value);}
  const covered=blocks.at(-1)?.end||0;
  return {state:covered?'read':'empty',blocks,channels,coverage:{complete:covered===raw.length&&links.length<=1000,
    charactersAvailable:raw.length,charactersRead:covered,linksAvailable:links.length,linksRead:allLinks.length,
    scope:'visible_text_and_explicit_contact_links',reason:covered<raw.length?'character_or_block_limit':links.length>1000?'link_limit':null}};
}
