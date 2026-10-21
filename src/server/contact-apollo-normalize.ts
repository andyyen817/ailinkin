import 'server-only';
const norm=(v:any)=>String(v||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function contactDomain(v:string){try{return new URL(v.includes('://')?v:'https://'+v).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
export function standardApolloInput(p:any){
  if(!String(p.name||'').trim()&&!p.providerId&&!p.profileUrl)throw Error('PERSON_IDENTITY_REQUIRED');
  return {...(p.providerId?{id:p.providerId}:{name:String(p.name).trim()}),
    ...(contactDomain(p.domain||'')?{domain:contactDomain(p.domain)}:{}),
    ...(p.profileUrl&&/^https:\/\/(www\.)?linkedin.com\/in\//.test(p.profileUrl)?{linkedin_url:p.profileUrl}:{}),
    reveal_personal_emails:false,reveal_phone_number:false,run_waterfall_email:false,run_waterfall_phone:false};
}
export function normalizeApolloPerson(target:any,raw:any,at=new Date().toISOString()){
  const p=raw.person;if(!p)return {state:'not_found',people:[],channels:[],observation:raw};
  const name=p.name||[p.first_name,p.last_name].filter(Boolean).join(' ');
  const employers=[{organization_name:p.organization?.name,domain:p.organization?.website_url,current:true,title:p.title},...(p.employment_history||[])];
  const matches=employers.filter(j=>norm(j.organization_name||j.organization?.name)===norm(target.companyName)||contactDomain(target.domain||'')&&contactDomain(j.domain||j.organization?.website_url||'')===contactDomain(target.domain));
  const identity=norm(name)===norm(target.name)&&matches.length>0;
  if(!identity)return {state:'identity_ambiguous',people:[],channels:[],observation:raw,notice:'姓名或企业关联不足；候选保存但不绑定个人渠道'};
  const evidence=[{sourceUrl:p.linkedin_url||p.organization?.website_url||'https://www.apollo.io',quote:JSON.stringify({id:p.id,name,title:p.title,organization:p.organization?.name,history:p.employment_history,email:p.email}),sourceType:'provider_receipt',retrievedAt:at}];
  const current=matches.some(j=>j.current===true),contacts:any[]=[];
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email||''))contacts.push({kind:'email',value:p.email,scope:'person',verification:'provider_work_email_candidate',
    ownership:'provider_candidate',channelEmployer:p.organization?.name||'未知',targetEmployer:current?'current_claim':'other_employer',providerId:p.id,observedAt:at,evidence});
  return {state:'matched_candidate',providerId:p.id,observation:raw,people:[{name:target.name,providerId:p.id,profileUrl:p.linkedin_url||'',title:p.title||'',
    relationship:current?'current_employee':'former_employee',employerClaim:p.organization?.name||'',employerVerified:false,contacts,evidence,
    careerHistory:employers.map(j=>({employer:j.organization_name||j.organization?.name||'',title:j.title||'',period:[j.start_date,j.end_date].filter(Boolean).join(' – '),status:j.current===true?'current_claim':j.end_date?'former_claim':'time_unknown',verification:'provider_claim',evidence}))}],
    channels:current&&p.organization?.phone?[{kind:'phone',value:p.organization.phone,scope:'company',verification:'provider_company_phone',evidence}]:[],
    notice:'身份、任职时间、渠道归属和技术可用性分别待核实'};
}
export function apolloDiscoveryInput(domain:string,page=1){
  if(!contactDomain(domain)||!Number.isInteger(page)||page<1||page>100)throw Error('DISCOVERY_INPUT_INVALID');
  return {q_organization_domains_list:[contactDomain(domain)],page,per_page:25};
}
