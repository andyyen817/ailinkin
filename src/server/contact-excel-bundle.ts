import 'server-only';import {z} from 'zod';
import type {contactExcelView} from './contact-excel-view';
export const contactBundleInput=z.array(z.object({campaignId:z.uuid(),companyIds:z.array(z.string().min(1).max(160)).min(1).max(3)}).strict()).min(1).max(2);
export function contactExportBundle(scope:any,row:any){
  if(scope?.tenantId!==row.tenant_id||!['known_profile_emails','free_contact_followup','free_email_ownership','free_contact_alternative','free_tomba','new_contact_free'].includes(scope?.batchType)||!(scope.batchType==='new_contact_free'?scope.people:scope.targets)?.some((t:any)=>t.campaignId===row.id))return null;
  const map=new Map<string,string[]>();for(const t of ['free_email_ownership','free_contact_alternative','free_tomba','new_contact_free'].includes(scope.batchType)?scope.exportTargets:scope.targets)map.set(t.campaignId,[...(map.get(t.campaignId)||[]),t.companyId]);
  return [...map].map(([campaignId,companyIds])=>({campaignId,companyIds:[...new Set(companyIds)]}));
}
export function contactAddressOverview(rows:string[][]){
  const addresses=new Map<string,Set<string[]>>(),valid=new Set<string>();
  for(const row of rows)for(const email of row[3].split('\n').filter(v=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))){
    const key=email.toLowerCase(),owners=addresses.get(key)||new Set<string[]>();owners.add(row);addresses.set(key,owners);
    if(row[3].split('\n').length===1?row[4].includes('技术验证通过'):row[4].split('\n').some(v=>v.startsWith(email+'：技术验证通过')))valid.add(key);
  }
  for(const owners of addresses.values())if(owners.size>1)for(const row of owners)row[7]='同一邮箱关联多条人物资料，归属未确认。请先核对，暂不发信。';
  return {validAddresses:valid.size,candidateAddresses:addresses.size,sharedAddresses:[...addresses.values()].filter(v=>v.size>1).length};
}
export function operatorContactSummary(rows:string[][]){
  const addresses=contactAddressOverview(rows),profiles=new Set(rows.flatMap(r=>r[6].split('\n').filter(v=>v.startsWith('http')).map(v=>v.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,''))));
  return `人物记录 ${rows.length} 条；个人主页 ${profiles.size} 个；候选邮箱 ${addresses.candidateAddresses} 个；技术验证通过 ${addresses.validAddresses} 个；归属冲突 ${addresses.sharedAddresses} 个；个人号码 ${rows.filter(r=>r[5]!=='未找到').length} 条`;
}
export function combineContactExcel(views:ReturnType<typeof contactExcelView>[]){
  if(!views.length)throw Error('CONTACT_BUNDLE_EMPTY');
  const sum=(key:'personRows'|'companyCount'|'channelRows'|'sourceRows')=>views.reduce((n,v)=>n+v[key],0);
  const counts={emails:0,validEmails:0,phones:0,profiles:0};for(const v of views)for(const k of Object.keys(counts) as (keyof typeof counts)[])counts[k]+=v.contactCounts[k];
  const result={...views[0],market:'三家企业',companyCount:sum('companyCount'),personRows:sum('personRows'),channelRows:sum('channelRows'),sourceRows:sum('sourceRows'),contactCounts:counts,
    sheets:views[0].sheets.map((s,i)=>({...s,rows:views.flatMap(v=>v.sheets[i].rows)}))};
  if(result.personRows>2000)throw Error('CONTACT_BUNDLE_TOO_LARGE');
  const address=contactAddressOverview(result.sheets[0].rows);
  result.contactSummary=operatorContactSummary(result.sheets[0].rows);
  return result;
}
