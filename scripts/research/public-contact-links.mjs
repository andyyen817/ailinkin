import {socialPlatform} from './platform-catalog.mjs';
import {browserPlatformUrl} from './browser-contact-policy.mjs';
const norm=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function publicContactLink(raw){
  try{const u=new URL(raw);if(u.username||u.password||u.port)return null;
    if(u.protocol==='tel:'){const v=decodeURIComponent(u.pathname);return /^[+()\d][\d\s()+.-]{6,30}$/.test(v)?{kind:'phone',value:v}:null;}
    if(u.protocol!=='https:')return null;
    if(['wa.me','api.whatsapp.com','web.whatsapp.com'].includes(u.hostname)){
      const phone=u.hostname==='wa.me'?u.pathname.slice(1):u.searchParams.get('phone');
      if(!/^\+?\d{7,15}$/.test(phone||''))return null;
      return {kind:'whatsapp',value:phone.replace(/^\+/,'')};
    }
    const platform=socialPlatform(raw);if(!platform||!browserPlatformUrl(platform,raw)||/^\/(?:share|sharer|help|search|home|explore|p|reel)(?:[/.]|$)/i.test(u.pathname)||u.pathname==='/')return null;
    if(platform==='LinkedIn'&&!/^\/(?:in|company)\/[^/]+\/?$/.test(u.pathname))return null;
    u.hash='';for(const key of [...u.searchParams.keys()])if(key!=='id')u.searchParams.delete(key);
    return {kind:'social',value:u.href.replace(/\/$/,'')};
  }catch{return null;}
}
/** Explicitly observed links only. Company-page ownership never implies individual ownership. */
/** @param {{url:string,text:string,links?:any[],personName?:string,companyName?:string,retrievedAt?:string}} input */
export function publishedContactLinks({url,text,links=[],personName='',companyName='',retrievedAt=new Date().toISOString()}){
  const result=[],seen=new Set(),body=norm(text),name=norm(personName);
  const associated=name&&body.includes(name)&&norm(companyName)&&body.includes(norm(companyName));
  for(const link of links){
    const raw=typeof link==='string'?link:link.url,label=typeof link==='string'?'':link.label||link.text||'',item=publicContactLink(raw);
    if(!item)continue;
    const line=String(text).split(/\r?\n/).find(v=>name&&norm(v).includes(name)&&v.includes(raw));
    const owned=!!associated&&(norm(label).includes(name)||!!line),scope=owned?'person':'unknown';
    const key=item.kind+':'+item.value+':'+scope;if(seen.has(key))continue;seen.add(key);
    result.push({...item,scope,...(owned?{personId:personName,ownerRef:personName}:{}),ownership:owned?'explicit_name_link':'needs_review',
      verification:'ownership_needs_review',provenance:'public_link',evidence:[{sourceUrl:url,quote:line||[label,raw].filter(Boolean).join(' '),retrievedAt,sourceType:'social_body'}]});
  }
  const self=publicContactLink(url);
  if(associated&&self?.kind==='social'&&/linkedin\.com\/in\/|reddit\.com\/(?:user|u)\//.test(url)){
    const quote=String(text).split(/\r?\n/).filter(v=>norm(v).includes(name)||norm(v).includes(norm(companyName))).join('\n').slice(0,4000);
    result.push({...self,scope:'person',personId:personName,ownerRef:personName,ownership:'profile_body_claim',verification:'ownership_needs_review',
      evidence:[{sourceUrl:url,quote,retrievedAt,sourceType:'social_body'}]});
  }
  return result;
}
