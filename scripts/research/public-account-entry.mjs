import {browserPlatformUrl} from './browser-contact-policy.mjs';
export function observedAccountEntry(account){
  const original=new URL(account.url);
  for(const proof of account.evidence||[]){
    try{const found=new URL(String(proof.quote||'').trim());
      if(browserPlatformUrl(account.platform,found.href)&&found.hostname.replace(/^www\./,'')===original.hostname.replace(/^www\./,'')&&found.pathname.replace(/\/$/,'')===original.pathname.replace(/\/$/,''))return {...account,url:found.href};
    }catch{}
  }
  return account;
}
export function approvedPreflightRetry(scope,target,history){
  if(scope.retryPreflightUrl!==target.url||history.some(j=>j.page?.preflightRetry?.url===target.url))return false;
  const host=new URL(target.url).hostname,pages=history.flatMap(j=>j.page?.pages||[]).filter(p=>p.url&&new URL(p.url).hostname===host);
  if(pages.some(p=>['robots_denied','restricted','needs_login','rate_limited'].includes(p.state)))return false;
  return pages.some(p=>p.state==='robots_unknown'&&['ROBOTS_TOO_LARGE','ROBOTS_NON_TEXT_RESPONSE','robots_rules_invalid'].includes(p.robotsEvidence?.failure||p.reason));
}
export function knownHtmlRobots(evidence,current=false){
  const response=evidence?.response?.attempts?.at(-1);
  return evidence?.status===200&&evidence.failure==='ROBOTS_NON_TEXT_RESPONSE'&&response?.status===200&&
    /^text\/html(?:;|$)/i.test(response.contentType||'')&&!!response.contentHash&&response.bytes>0&&
    (!current||response.hasRuleLines===false);
}
export function publicPreviewAllowedUrl(scope,url){return scope.singlePublicPreviewUrl===url||scope.discoveryPreviewUrls?.includes(url)||false;}
export function approvedPublicPreview(scope,target,history){
  if(scope.mode!=='anonymous_public'||scope.singlePublicPreviewUrl!==target.url||!target.evidence?.length||
    !scope.platforms.includes(target.platform)||!browserPlatformUrl(target.platform,target.url))return false;
  const same=history.filter(j=>j.scopeId===scope.id),host=new URL(target.url).hostname.replace(/^www\./,'');
  if(same.some(j=>j.page?.publicPreviewAttempt?.url===target.url))return false;
  const pages=same.flatMap(j=>j.page?.pages||[]);
  if(pages.some(p=>p.url&&new URL(p.url).hostname.replace(/^www\./,'')===host&&
    (['robots_denied','restricted','needs_login','rate_limited','needs_user_action'].includes(p.state)||[401,403,429].includes(p.robotsEvidence?.status))))return false;
  return pages.some(p=>p.url===target.url&&p.state==='robots_unknown'&&knownHtmlRobots(p.robotsEvidence));
}
export function publicPreviewNavigation(s,url){
  const record=s.robots.get(new URL(url).origin);
  if(!s.anonymous||s.singlePublicPreviewAuthorizedUrl!==url||!publicPreviewAllowedUrl(s.scope,url)||
    s.publicPreviewUsed||Date.now()>=s.expiresAt||record?.checked||
    !knownHtmlRobots({status:record?.status,failure:record?.failure,response:record?.diagnostics},true))return false;
  s.publicPreviewUsed=true;
  s.events.push({action:'single_public_preview_navigation',url,robotsState:'unknown_html',at:new Date().toISOString()});
  return true;
}
