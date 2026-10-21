import 'server-only';
import {createHash} from 'node:crypto';
import {publicContactLink} from '../../scripts/research/public-contact-links.mjs';
import {traceNorm,tracePageIdentity} from './contact-trace-frontier';
const generic=/^(?:info|hello|contact|support|sales|admin|office|service|careers|hr|press|reservations|booking)@/i;
const addresses=(v:string)=>[...new Set(v.match(/(?<![\w.+%*\-])[\w.+%-]+@[\w.-]+\.[a-z]{2,}(?![\w*])/gi)||[])].map(v=>v.toLowerCase());
function social(raw:string){const item=publicContactLink(raw);if(item?.kind==='social')return item.value;try{const u=new URL(raw);if(u.protocol==='https:'&&/(?:^|\.)tiktok\.com$/.test(u.hostname)&&/^\/@[^/]+\/?$/.test(u.pathname)){u.search='';u.hash='';return u.href.replace(/\/$/,'');}}catch{}return null;}
export function traceOwnershipEvidence(p:any,page:any,people:any[]=[]){
  const result={emails:[] as any[],accounts:[] as any[],evidence:[] as any[]};if(page.state!=='read')return result;
  const names=[p.name,...p.traceAliases||[]].filter(Boolean),contains=(v:string)=>names.some(n=>traceNorm(v).includes(traceNorm(n)));
  const id=tracePageIdentity(p,page),units=page.format==='pdf'?page.pages:[{text:page.personText||'',number:undefined,sourceUrl:page.url}];
  for(const unit of units||[]){
    const text=String(unit.text||''),lines=text.split(/\r?\n/),named=contains(text);if(!named)continue;
    const hash=page.rawArtifact?.sha256||createHash('sha256').update(text).digest('hex');
    const evidence=(quote:string,proof:string)=>({sourceUrl:unit.sourceUrl||page.url,pageNumber:unit.number,sourceType:page.format==='pdf'?'public_pdf_text':'website_body',quote:quote.slice(0,1600),retrievedAt:page.readAt,contentHash:hash,ownerProof:proof,employmentStatus:'现职仍需单独核实'});
    for(const email of addresses(text).filter(v=>!generic.test(v))){
      const direct=lines.find(line=>contains(line)&&line.toLowerCase().includes(email)&&addresses(line).length===1&&!people.some(other=>other.personKey!==p.personKey&&traceNorm(line).includes(traceNorm(other.name)))&&!/on behalf of|assistant to|press contact|media contact/i.test(line));
      const labelled=(page.links||[]).some((l:any)=>l.url.toLowerCase().startsWith('mailto:'+email)&&contains(l.label||''));
      const block=lines.flatMap((line,index)=>contains(line)?[lines.slice(Math.max(0,index-1),index+3).join('\n')]:[]).find(v=>v.toLowerCase().includes(email)&&addresses(v).length===1&&!people.some(other=>other.personKey!==p.personKey&&traceNorm(v).includes(traceNorm(other.name))));
      const work=email.split('@')[1]===p.domain||email.split('@')[1].endsWith('.'+p.domain);
      const contextual=!!block&&(id.confirmed||page.format==='pdf'&&(traceNorm(text).includes(traceNorm(p.companyName))||new URL(page.url).hostname.replace(/^www\./,'')===p.domain));
      const confirmed=!!(work&&(direct||labelled||contextual));
      result.emails.push({value:email,confirmed,ownership:confirmed?'公开原文将姓名与公司域名邮箱直接对应':'公开邮箱候选，归属待核',evidence:[evidence(direct||block||email,confirmed?'explicit_named_business_email':'unconfirmed_candidate')]});
    }
    result.evidence.push(evidence(lines.filter(contains).slice(0,3).join('\n'),'named_public_text'));
  }
  const own=social(page.url),links=[...(page.links||[]),...(own?[{url:own,label:page.heading||''}]:[])];
  for(const link of links){
    const value=social(link.url);if(!value||/linkedin\.com\//.test(value)||result.accounts.some(a=>a.value===value))continue;
    const named=contains(link.label||''),directSelf=!id.official&&(id.ownProfile||id.ownLink);
    const confirmed=!!(id.confirmed&&(named||directSelf));
    const selfCandidate=value===own&&id.named&&id.personalHeading&&id.employer;
    if(!confirmed&&!named&&!selfCandidate)continue;
    result.accounts.push({value,confirmed,ownership:confirmed?'已确认人物公开主页的直接外链':'姓名与职业信息相符的候选，尚无充分互链证据',evidence:[{sourceUrl:page.url,quote:[page.heading,link.label,value,directSelf?p.profileUrl:''].filter(Boolean).join('\n'),retrievedAt:page.readAt,contentHash:createHash('sha256').update(page.personText||'').digest('hex'),sourceType:'website_body',ownerProof:confirmed?'personal_profile_direct_link':'multi_signal_candidate'}]});
  }
  return result;
}
