import 'server-only';
import {createHash} from 'node:crypto';
import {publicContactLink} from '../../scripts/research/public-contact-links.mjs';
const norm=(v:string)=>String(v||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const profile=(v:string)=>String(v||'').toLowerCase().replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'');
const generic=/^(?:info|hello|contact|support|sales|admin|office|service|careers|hr|press|reservations|booking)@/i;
export function enrichmentQuery(p:any){return `"${p.name.replace(/["\r\n]/g,' ')}" "${p.companyName.replace(/["\r\n]/g,' ')}" -site:linkedin.com`;}
export function enrichmentCandidates(p:any,results:any[]){
  return [...new Map(results.flatMap(r=>{
    try{const u=new URL(r.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||/linkedin\.com$/.test(u.hostname)||/\.(?:pdf|zip|jpg|png|mp4)$/i.test(u.pathname))return [];
      const named=norm([r.title,r.snippet].join(' ')).includes(norm(p.name));return named?[[u.href,{...r,url:u.href}]]:[];}catch{return [];}
  })).values()].slice(0,2);
}
export function extractEnrichmentEvidence(p:any,page:any){
  const text=String(page.personText||(page.blocks||[]).map((b:any)=>b.text).join('\n')),named=norm(text).includes(norm(p.name)),employer=norm(text).includes(norm(p.companyName));
  const bodyHash=createHash('sha256').update(text).digest('hex'),readAt=page.readAt||new Date().toISOString();
  const empty={emails:[] as any[],accounts:[] as any[],evidence:[] as any[],bodyHash,named,employer};
  if(page.state!=='read'||!named)return empty;
  const host=new URL(page.url).hostname.replace(/^www\./,''),official=host===p.domain||host.endsWith('.'+p.domain);
  const heading=norm(page.heading||''),personalHeading=heading.includes(norm(p.name))&&heading.length<norm(p.name).length+45;
  const backLink=(page.links||[]).some((l:any)=>profile(l.url)===profile(p.profileUrl));
  const identity=(official&&personalHeading)||(backLink&&personalHeading&&employer);
  const evidence=(quote:string)=>({sourceUrl:page.url,quote:quote.slice(0,1600),retrievedAt:readAt,sourceType:'website_body',contentHash:bodyHash});
  const nameLines=text.split(/[\r\n]+/).filter(line=>norm(line).includes(norm(p.name)));
  const published=[...new Set(text.match(/(?<![\w.+%*\-])[\w.+%-]+@[\w.-]+\.[a-z]{2,}(?![\w*])/gi)||[])];
  for(const value of published){
    const email=value.toLowerCase();if(generic.test(email))continue;
    const line=nameLines.find(line=>line.toLowerCase().includes(email));
    const explicitLink=(page.links||[]).some((l:any)=>l.url.toLowerCase().startsWith('mailto:'+email)&&norm(l.label||'').includes(norm(p.name)));
    const emailDomain=email.split('@')[1],workDomain=emailDomain===p.domain||emailDomain.endsWith('.'+p.domain);
    const confirmed=!!(identity&&workDomain&&(line||explicitLink));
    empty.emails.push({value:email,confirmed,ownership:confirmed?'公开姓名与邮箱直接对应':'公开邮箱候选，归属待核',evidence:[evidence(line||`${page.heading||''}\n${email}`)]});
  }
  const self=publicContactLink(page.url),links=[...(page.links||[]),...(self?.kind==='social'?[{url:page.url,label:page.heading||''}]:[])];
  for(const l of links){
    const channel=publicContactLink(l.url);if(channel?.kind!=='social'||/linkedin\.com\//.test(channel.value))continue;
    const directlyNamed=norm(l.label||'').includes(norm(p.name));
    const confirmed=!!(identity&&(directlyNamed||!official&&backLink));
    if(!directlyNamed&&!confirmed)continue;
    if(empty.accounts.some(a=>a.value===channel.value))continue;
    empty.accounts.push({value:channel.value,confirmed,ownership:confirmed?'本人资料互链或公司实名页面明确关联':'同名账号候选，尚未确认',evidence:[evidence([page.heading,l.label,l.url,backLink?p.profileUrl:''].filter(Boolean).join('\n'))]});
  }
  empty.evidence.push(evidence(nameLines.slice(0,3).join('\n')));return empty;
}
