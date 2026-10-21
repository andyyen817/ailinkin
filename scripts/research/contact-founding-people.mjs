import {validateContactPeople} from './contact-evidence-validator.mjs';
const version='explicit-founding-pair-v1';
const escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function recoverFoundingPeople(data,batch,now=Date.now()){
  let added=0;
  for(const run of data.contactResearchRuns||[]){
    if(run.batchId!==batch.id||run.state!=='done'||run.page?.method!=='public_html'||run.localExtraction?.version===version||
      !run.requests?.some(q=>q.service==='social_public'&&q.status==='done')||run.requests.some(q=>['unknown','pending'].includes(q.status)))continue;
    const company=data.companies.find(c=>c.id===run.companyId);if(!company||!batch.companyIds.includes(company.id))continue;
    const host=new URL(company.website).hostname.replace(/^www\./,'');
    if(!run.page.links?.some(l=>{try{return new URL(typeof l==='string'?l:l.url).hostname.replace(/^www\./,'')===host;}catch{return false;}}))continue;
    const name="[A-Z][A-Za-zÀ-ÿ'-]+(?: [A-Z][A-Za-zÀ-ÿ'-]+){1,3}";
    const pattern=new RegExp(escape(company.name)+" (?:was )?founded by ("+name+") and (?:(?:his|her|their) (?:then[- ]fianc[ée]+|wife|husband) )?("+name+")\\.",'g');
    const people=[];
    for(const block of run.page.blocks||[])for(const match of String(block.text||'').matchAll(pattern))for(const personName of [match[1],match[2]]){
      const input={company,blocks:[{...block,sourceType:'website_body'}]},raw={people:[{name:personName,title:'',relationship:'founder',employer:company.name,evidence:[{id:block.id,quote:match[0]}]}],unknowns:[]};
      const result=validateContactPeople(raw,input);for(const p of result.people){p.detailUnknowns.push('公开网页的历史创立提及；当前职务、任职日期和个人联系方式仍未知。');people.push(p);}
    }
    if(!people.length)continue;
    run.people||=[];for(const person of people)if(!run.people.some(p=>p.sourcePersonId===person.sourcePersonId)){run.people.push(person);added++;}
    run.localExtraction={version,method:'explicit_founding_statement',extractedAt:new Date(now).toISOString(),externalRequests:0};
    (run.recoveryHistory||=[]).push({action:'extract_explicit_founding_statement',recoveredAt:new Date(now).toISOString(),externalRequests:0});
  }
  return added;
}
