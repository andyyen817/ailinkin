import {createHash} from 'node:crypto';
const host=url=>new URL(url).hostname.toLowerCase().replace(/^www\./,'');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function companyContactRoutes(entity,now=new Date()){
  if(!entity.ownership?.verified||!entity.companyId)throw Error('OFFICIAL_IDENTITY_REQUIRED');
  const routes=[],seen=new Set(),pages=(entity.websitePages||[]).filter(p=>{
    try{return p.content&&host(p.url)===host(entity.ownership.url)&&p.retrievedAt&&Date.parse(p.retrievedAt)<=now.getTime();}catch{return false;}
  });
  const add=(kind,value,page,quote,scope,extra={})=>{
    const key=kind+':'+value;if(seen.has(key))return;seen.add(key);
    routes.push({id:digest([entity.companyId,key,page.url]).slice(0,24),kind,value,scope,
      sourceUrl:page.url,quote,retrievedAt:page.retrievedAt,sourceHash:digest(page.content),
      status:now.getTime()-Date.parse(page.retrievedAt)>30*86400000?'资料过期待重查':'官网已刊载，实际可联系性待验证',...extra});
  };
  for(const page of pages){
    const text=page.content,isStore=/store|outlet|location/i.test(new URL(page.url).pathname),isContact=/contact/i.test(page.url);
    if(isContact&&/contact\s*(?:us)?|get in touch/i.test(text)){
      const quote=text.match(/contact\s*(?:us)?|get in touch/i)[0];
      add('contact_page',page.url,page,quote,'company',{submissionVerified:false,purposeVerified:false});
    }
    for(const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)){
      if(/example\.(com|invalid)|protected|noreply|no-reply/i.test(match[0]))continue;
      add('email',match[0].toLowerCase(),page,match[0],isStore?'store':'company',{emailVerification:'unknown',personVerified:false});
    }
    for(const match of text.matchAll(/(?:Phone|Telephone|Tel)[\s:]+([+()\d][\d\s()+-]{6,23})|(?:^|\n)(\(\+?\d{2,5}\)[\d\s()-]{5,18})(?=\n|$)/gim)){
      const phone=(match[1]||match[2]).trim();if(phone.replace(/\D/g,'').length<8)continue;
      add('phone',phone,page,match[0].trim(),isStore?'store':'company',{directResponsiblePerson:false});
    }
  }
  return {companyId:entity.companyId,entityId:entity.id,name:entity.name,routes,
    basisHash:digest(pages.map(p=>[p.url,p.content,p.retrievedAt])),updatedAt:now.toISOString()};
}
export function responsibleReview(company,contacts,group,now=new Date()){
  const people=contacts.filter(p=>p.companyId===company.id&&!p.suppressed&&p.employerVerified&&p.employerEvidence&&
    p.updatedAt&&now.getTime()-Date.parse(p.updatedAt)<30*86400000);
  return {status:people.length?'当前任职已有来源；采购职责仍需核实':'未核实具体负责人',
    confirmedProcurementPeople:0,candidates:people.map(p=>({name:p.name,title:p.title,source:p.employerEvidence})),
    suggestedRoles:group.decisionRoles||[],purchaseAuthority:'未确认',purchaseIntent:'未确认'};
}
