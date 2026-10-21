import {createHash} from 'node:crypto';
import {contactSchema,normalizeLinkedin} from '@/domain/contacts';
import {emailContactState} from './personal-contact-summary';
import {AccessError} from './policy';

export const reviewHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function operatorCrmReview(row:any,tenantId:string,batchId:string,now=Date.now()){
  if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)throw new AccessError('SEARCH_NOT_FOUND',404);
  const batch=row.data.operatorBatches?.find((b:any)=>b.id===batchId);
  if(!batch||batch.state!=='done'||row.state==='running'||row.data.operatorLease)
    throw new AccessError('CRM_BATCH_NOT_READY',409);
  if(!Array.isArray(batch.people)||batch.people.length>100)throw new AccessError('CRM_BATCH_LIMIT',409);
  const keys=new Set();
  const people=batch.people.map((person:any)=>{
    if(!person.personKey||keys.has(person.personKey)||person.campaignId!==row.id)
      throw new AccessError('CRM_PERSON_SCOPE_INVALID',409);
    keys.add(person.personKey);
    let linkedin='';
    try{linkedin=normalizeLinkedin(person.profileUrl||'');}catch{}
    const candidate=(person.emailCandidates||[]).find((c:any)=>
      c.confirmed&&c.value?.toLowerCase()===person.email?.toLowerCase()&&
      c.evidence?.some((e:any)=>e.sourceType!=='provider_receipt'&&
        /^https?:\/\//.test(e.sourceUrl||'')&&/^[a-f0-9]{64}$/.test(e.contentHash||'')&&e.quote));
    const email=candidate&&emailContactState(person,now)==='技术验证通过'?person.email:'';
    const proof=[...(person.ownershipEvidence||[]),
      ...(person.emailCandidates||[]).flatMap((c:any)=>c.evidence||[]),
      ...(person.otherAccounts||[]).flatMap((c:any)=>c.evidence||[])];
    const notes=[
      '从获客批次审核入库；任职及采购需求仍需运营确认。',
      '邮箱候选：'+((person.emailCandidates||[]).map((c:any)=>c.value).join('；')||person.email||'未取得'),
      '邮箱归属：'+(person.ownershipState||'尚未核实')+'；技术状态：'+emailContactState(person,now),
      '本人其他平台：'+((person.otherAccounts||[]).map((c:any)=>c.value+'（'+(c.confirmed?'已核实本人':'候选待核')+'）').join('；')||'未取得'),
      '资料来源：'+[linkedin,...proof.map((e:any)=>e.sourceUrl)].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('\n'),
      '处理说明：'+(person.reason||'')
    ].join('\n').slice(0,10000);
    const company=row.data.companies?.find((c:any)=>c.id===person.companyId);
    const parsed=contactSchema.safeParse({
      name:person.name,company:person.companyName,title:person.title||'',
      country:row.data.project.country||'',linkedin,email,emailStatus:email?'verified':'unknown',
      stage:'待筛选',tags:['获客批次审核','任职与需求待核实'],notes,
      doNotContact:!!(person.doNotContact||person.suppressed||company?.doNotContact)
    });
    const reason=!parsed.success?'姓名、公司或联系方式格式不完整':
      !linkedin&&!email?'缺少可用于去重的个人主页或已核实邮箱':'';
    return {personKey:person.personKey,name:person.name,companyName:person.companyName,
      title:person.title||'',profileUrl:linkedin,candidateEmail:person.email||'',
      emailState:emailContactState(person,now),usableEmail:email,reason,
      canSave:!reason,data:parsed.success?parsed.data:null};
  });
  return {batchId,people,basisHash:reviewHash(people)};
}

export function operatorCrmMatch(person:any,contacts:any[]){
  const data=person.data;
  if(!data)return {reason:person.reason,contact:null};
  const matches=contacts.filter(c=>(data.linkedin&&c.data.linkedin===data.linkedin)||
    (data.email&&c.data.email?.toLowerCase()===data.email.toLowerCase()));
  if(matches.length>1)return {reason:'主页与邮箱对应不同客户，需人工核对',contact:null};
  const contact=matches[0]||null;
  if(contact&&data.email&&contact.data.email===data.email&&
    contact.data.linkedin&&data.linkedin&&contact.data.linkedin!==data.linkedin)
    return {reason:'邮箱对应另一主页，暂不自动合并',contact:null};
  return {reason:'',contact};
}
