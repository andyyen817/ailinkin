import 'server-only';
import {relevantPersonText} from './person-research-plan';
import {publishedContactLinks} from '../../scripts/research/public-contact-links.mjs';
export function limitPersonFields(result:any,fields:string[]){
  if(!result||Array.isArray(result))return result;
  const allowed=(c:any)=>c.kind==='email'?fields.includes('work_email'):['phone','whatsapp'].includes(c.kind)?fields.includes('public_phone'):fields.includes('profile');
  return {...result,...(Array.isArray(result.people)?{people:result.people.map((p:any)=>({...p,profileUrl:fields.includes('profile')?p.profileUrl:'',title:fields.includes('career')?p.title:'',careerHistory:fields.includes('career')?p.careerHistory:[],contacts:(p.contacts||[]).filter(allowed)}))}:{}),...(Array.isArray(result.channels)?{channels:result.channels.filter(allowed)}:{})};
}
export function extractPublicPerson(person:any,page:any){
  const people:any[]=[],channels:any[]=[],observations:any[]=[];
  if(!page.relevant||!relevantPersonText(person.name,person.companyName,(page.blocks||[]).map((b:any)=>b.text||'').join('\n')))
    return {people,channels,observations,notice:'没有姓名与企业相关正文，不提取人物渠道'};
  const evidence:any[]=[];const contacts:any[]=[];
  for(const block of page.blocks||[]){
    const text=String(block.text||'');if(!text)continue;
    const ev={sourceUrl:block.sourceUrl||block.url||page.url,quote:text,retrievedAt:page.readAt||new Date().toISOString(),sourceType:page.sourceType||'website_body'};
    if(!/^https?:\/\//.test(ev.sourceUrl||''))continue;evidence.push(ev);
    // A page-level name match does not establish ownership of every address on that page.
    for(const line of text.split(/[\n\r]+/)){
      const named=relevantPersonText(person.name,person.companyName,line),generic=/\b(info|hello|contact|support|sales|admin|office)@/i;
      const values=[...(line.match(/(?<![\w.+%*\-])[\w.+%-]+@[\w.-]+\.[a-z]{2,}(?![\w*])/gi)||[])];
      for(const email of values){const own=named&&!generic.test(email);
        const item={kind:'email',value:email,scope:own?'person':generic.test(email)?'company':'unknown',ownership:own?'same_line_claim':'needs_review',verification:'unverified',provenance:'public_text',evidence:[{...ev,quote:line}]};
        if(own)contacts.push(item);else channels.push(item);
      }
      const phone=line.match(/(?:\+\d[\d ()-]{7,}\d)/g)||[];
      for(const value of phone){const item={kind:'phone',value,scope:named?'person':'unknown',ownership:named?'same_line_claim':'needs_review',verification:'format_only',evidence:[{...ev,quote:line}]};if(named)contacts.push(item);else channels.push(item);}
    }
  }
  for(const c of publishedContactLinks({url:page.url,text:(page.blocks||[]).map((b:any)=>b.text).join('\n'),links:page.links||[],personName:person.name,companyName:person.companyName,retrievedAt:page.readAt})){
    if(c.scope==='person')contacts.push(c);else channels.push(c);
  }
  if(evidence.length)people.push({name:person.name,sourcePersonId:person.sourcePersonId,personId:person.personId,relationship:'unknown',employerVerified:false,contacts,evidence,detailUnknowns:['任职和渠道归属需结合原文判断；未推测缺失资料']});
  return {people,channels,observations,notice:'公开原文已按规则提取；无需等待模型，技术有效性尚未验证'};
}
export function observedPersonLinks(person:any,page:any){
  const links=page.links||page.navigation||[];
  return links.filter((l:any)=>l.url&&relevantPersonText(person.name,person.companyName,[l.text||l.label,person.companyName].join(' '))).map((l:any)=>l.url).filter((v:string)=>/^https?:\/\//.test(v)).slice(0,2);
}
