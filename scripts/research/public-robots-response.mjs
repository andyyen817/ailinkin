import {createHash} from 'node:crypto';
import {browserPlatformUrl} from './browser-contact-policy.mjs';
const redirects=new Set([301,302,303,307,308]);
const maxBytes=1048576;
export async function publicRobotsResponse(s,url){
  const initial=new URL('/robots.txt',url),attempts=[];let target=initial.href,lastStatus=null;
  const result=(text='',failure=null)=>({status:lastStatus,text,failure,diagnostics:{initialUrl:initial.href,finalUrl:target,attempts}});
  for(let hop=0;hop<=5;hop++){
    if(!s.anonymous||Date.now()>=s.expiresAt||s.usage.networkRequests+s.reservedNetwork>=s.scope.maxNetworkRequests)return result('','ROBOTS_SCOPE_OR_BUDGET');
    s.reservedNetwork++;
    try{
      await s.resolvePublic(target);if(Date.now()>=s.expiresAt)return result('','ROBOTS_SCOPE_EXPIRED');
      await s.beforePublicRequest?.({url:target});s.usage.networkRequests++;s.events.push({action:'robots_request',url:target,at:new Date().toISOString()});
      const response=await s.context.request.get(target,{timeout:12000,maxRedirects:0});lastStatus=response.status();
      const headers=response.headers?.()||{},type=String(headers['content-type']||'').slice(0,120),length=Number(headers['content-length']);
      const diagnostic={url:target,status:lastStatus,contentType:type,declaredBytes:Number.isFinite(length)&&length>=0?length:null};attempts.push(diagnostic);
      if(redirects.has(lastStatus)){
        let next;try{next=new URL(headers.location,target);}catch{return result('','ROBOTS_REDIRECT_LOCATION_INVALID');}
        diagnostic.redirectTo=next.origin+next.pathname;
        if(hop===5)return result('','ROBOTS_REDIRECT_LIMIT');
        const sameHost=next.hostname.replace(/^www\./,'')===initial.hostname.replace(/^www\./,'');
        if(next.protocol!=='https:'||next.username||next.password||next.port||!sameHost||next.pathname!=='/robots.txt')return result('','ROBOTS_REDIRECT_OUTSIDE_SCOPE');
        if(s.stage==='social'&&!browserPlatformUrl(s.platform,next.href))return result('','ROBOTS_REDIRECT_OUTSIDE_PLATFORM');
        target=next.href;continue;
      }
      if([404,410].includes(lastStatus))return result();
      if(lastStatus!==200)return result('','ROBOTS_HTTP_'+lastStatus);
      if(length>maxBytes)return result('','ROBOTS_TOO_LARGE');
      const text=await response.text(),bytes=Buffer.byteLength(text);diagnostic.bytes=bytes;diagnostic.contentHash=createHash('sha256').update(text).digest('hex');
      if(bytes>maxBytes)return result('','ROBOTS_TOO_LARGE');
      diagnostic.hasRuleLines=text.split(/\r?\n/).some(l=>/^\s*(?:user-agent|allow|disallow|crawl-delay):/i.test(l));
      if(type&&!/^text\/plain(?:;|$)/i.test(type)||/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(text))return result('',diagnostic.hasRuleLines?'ROBOTS_NON_TEXT_WITH_RULES':'ROBOTS_NON_TEXT_RESPONSE');
      if(text.includes('\ufffd'))return result('','ROBOTS_ENCODING_INVALID');
      diagnostic.ruleExcerpt=text.split(/\r?\n/).filter(l=>/^\s*(?:user-agent|allow|disallow|crawl-delay):/i.test(l)).slice(0,30).join('\n').slice(0,3000);
      return result(text);
    }catch(e){attempts.push({url:target,status:null,failure:String(e.message||e).split('\n')[0]});return result('','ROBOTS_RESPONSE_UNKNOWN');}
    finally{s.reservedNetwork--;}
  }
  return result('','ROBOTS_REDIRECT_LIMIT');
}
