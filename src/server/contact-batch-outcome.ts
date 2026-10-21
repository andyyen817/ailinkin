import 'server-only';
import type {ReviewRow} from '@/domain/contact-review';
import {emailContactState,personalContactSummary} from './personal-contact-summary';
export function contactUrlKey(value:string){
  try{const u=new URL(value);return u.hostname.toLowerCase().replace(/^www\./,'')+u.pathname.replace(/\/$/,'').replace(/\/photos$/,'').toLowerCase();}catch{return value.trim().toLowerCase();}
}
const labels={verified:'邮箱已验证，归属待核',conflict:'邮箱归属冲突',candidate:'邮箱尚未确认',profile:'可查看个人主页',phone:'有个人号码待核',missing:'未找到个人渠道',excluded:'请勿联系'};
export function contactBatchOutcome(rows:ReviewRow[],now=Date.now()){
  const people=rows.filter(r=>r.kind==='person'),owners=new Map<string,Set<string>>(),names=new Map<string,Set<string>>();
  for(const p of people){
    const name=p.companyId+':'+p.name.trim().toLowerCase().replace(/\s+/g,' '),same=names.get(name)||new Set<string>();same.add(p.id);names.set(name,same);
    for(const c of p.personChannels||[])if(c.kind==='email'&&c.scope==='person'){
      const email=c.value.toLowerCase(),set=owners.get(email)||new Set<string>();set.add(p.id);owners.set(email,set);
    }
  }
  const shared=new Set([...owners].filter(([,ids])=>ids.size>1).map(([email])=>email)),valid=new Set<string>(),profiles=new Set<string>(),phones=new Set<string>();
  const results=people.map(p=>{
    const summary=personalContactSummary(p,now),emails=(p.personChannels||[]).filter(c=>c.kind==='email'&&c.scope==='person');
    for(const c of emails)if(emailContactState(c,now)==='技术验证通过')valid.add(c.value.toLowerCase());
    for(const u of summary.profiles.split('\n'))if(u.startsWith('http'))profiles.add(contactUrlKey(u));
    for(const c of p.personChannels||[])if(c.scope==='person'&&['phone','whatsapp'].includes(c.kind))phones.add(c.kind+':'+c.value);
    const conflicts=emails.filter(c=>shared.has(c.value.toLowerCase())).map(c=>c.value);
    const code:keyof typeof labels=p.doNotContact?'excluded':conflicts.length?'conflict':summary.hasValidEmail?'verified':summary.hasEmail?'candidate':summary.hasPhone?'phone':summary.hasProfile?'profile':'missing';
    const reason=code==='excluded'?'原资料已标记请勿联系。':code==='conflict'?'同一邮箱关联多条人物资料：'+conflicts.join('、')+'。':code==='verified'?'邮箱技术验证通过；人物归属及现任仍需复核。':code==='candidate'?'已有邮箱候选，尚未确认具体邮箱存在；不能当作有效个人邮箱。':code==='profile'?'已保存个人主页，未找到个人邮箱或电话。':code==='phone'?'来源提供了个人号码，尚未实际拨测。':'已保存资料中未找到个人邮箱、电话或主页。';
    const nextAction=code==='excluded'?'保留记录，请勿联系':code==='conflict'?'保留标黄，核对归属后再决定':code==='verified'?'核对人物归属与任职，再由销售选择':code==='candidate'?(summary.hasProfile?'保留候选；先查看个人主页':'保留候选及来源，继续下一位'):code==='profile'?'打开个人主页，判断是否适合联系':code==='phone'?'先核对号码归属':'记录缺项，继续下一位';
    const sameName=(names.get(p.companyId+':'+p.name.trim().toLowerCase().replace(/\s+/g,' '))?.size||0)>1;
    return {rowId:p.id,personId:p.personId||'',companyId:p.companyId,companyName:p.companyName,name:p.name,title:p.title||'职位待核实',code,status:labels[code],reason,nextAction,
      email:summary.email,emailState:summary.emailState,phone:summary.phone,profiles:summary.profiles,hasEmail:summary.hasEmail,hasProfile:summary.hasProfile,
      duplicateNotice:sameName?'存在同名记录，缺少共同身份依据，未自动合并。':'',basisHash:p.basisHash};
  });
  const publicRows=rows.filter(r=>r.kind==='channel'&&['company','store'].includes(r.scope));
  return {people:results,counts:{personRecords:people.length,recordsWithEmail:results.filter(p=>p.hasEmail).length,candidateEmails:owners.size,validEmails:valid.size,
    personalProfiles:profiles.size,personalPhones:phones.size,sharedEmails:shared.size,conflictRecords:results.filter(p=>p.code==='conflict').length,
    missingRecords:results.filter(p=>p.code==='missing').length,profileOnlyRecords:results.filter(p=>p.code==='profile').length,
    candidateRecords:results.filter(p=>p.code==='candidate').length,verifiedRecords:results.filter(p=>p.code==='verified').length,
    sameNameRecords:results.filter(p=>p.duplicateNotice).length,
    companySocialAccounts:new Set(publicRows.filter(r=>r.channelKind==='social').map(r=>r.companyId+':'+contactUrlKey(r.value))).size,
    companyEmails:new Set(publicRows.filter(r=>r.channelKind==='email').map(r=>r.companyId+':'+r.value.toLowerCase())).size,
    companyPhones:new Set(publicRows.filter(r=>['phone','whatsapp'].includes(r.channelKind)).map(r=>r.companyId+':'+r.value)).size,
    companyContactPages:new Set(publicRows.filter(r=>r.channelKind==='contact_page').map(r=>r.companyId+':'+contactUrlKey(r.value))).size},
    notice:'人物记录不等于已确认的独立人数。邮箱技术验证不代表人物归属。未找到的资料保留原因并继续下一位。'};
}
