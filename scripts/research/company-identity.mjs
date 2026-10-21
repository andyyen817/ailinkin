const shared=['facebook.com','instagram.com','x.com','linkedin.com','reddit.com','alibaba.com','made-in-china.com'];
export function companyHost(value){
  try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';
    return u.hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
  }catch{return '';}
}
export function exclusiveDomain(company){
  if(company.sharedDomain||company.organizationType==='store')return '';
  const domain=companyHost(company.website);
  return shared.some(d=>domain===d||domain.endsWith('.'+d))?'':domain;
}
export function findCompany(companies,item){
  if(item.registryId&&item.registryVerified){
    const exact=companies.find(c=>c.registryVerified&&c.registryId===item.registryId);if(exact)return exact;
  }
  if(item.apolloId){
    const exact=companies.find(c=>c.apolloId===item.apolloId);if(exact)return exact;
  }
  const domain=exclusiveDomain(item);if(!domain)return null;
  return companies.find(c=>{
    if(c.registryVerified&&item.registryVerified&&c.registryId!==item.registryId)return false;
    if(c.apolloId&&item.apolloId&&c.apolloId!==item.apolloId)return false;
    return exclusiveDomain(c)===domain;
  })||null;
}
