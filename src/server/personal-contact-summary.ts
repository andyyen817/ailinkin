import type {ReviewRow} from '@/domain/contact-review';
export function emailContactState(channel:any,now=Date.now()){
  const t=channel.technical;
  if(!t)return '尚未验证';
  if(t.pending)return '验证处理中';
  if(['invalid','disposable'].includes(t.status))return '验证未通过，请勿使用';
  if(t.status==='catch_all'||t.status==='accept_all')return '无法确认具体邮箱存在';
  if(!t.verifiedAt||!Number.isFinite(Date.parse(t.verifiedAt))||Date.parse(t.verifiedAt)>now)return '缺少有效验证日期';
  if(!t.expiresAt||!Number.isFinite(Date.parse(t.expiresAt))||Date.parse(t.expiresAt)<=now)return '验证已过期，需重新验证';
  return t.status==='valid'?'技术验证通过':'尚未确认有效';
}
export function personalContactSummary(row:ReviewRow,now=Date.now()){
  const channels=(row.personChannels||[]).filter(c=>c.scope==='person');
  const emails=channels.filter(c=>c.kind==='email'),phones=channels.filter(c=>['phone','whatsapp'].includes(c.kind));
  const profileKey=(value:string)=>{try{const u=new URL(value);return u.hostname.replace(/^www\./,'')+u.pathname.replace(/\/$/,'');}catch{return value;}};
  const profiles=[...new Map([row.profileUrl,...channels.filter(c=>c.kind==='social').map(c=>c.value)].filter(Boolean).map(v=>[profileKey(v),v])).values()];
  const valid=emails.filter(c=>emailContactState(c,now)==='技术验证通过');
  const emailState=emails.map(c=>`${emails.length>1?c.value+'：':''}${emailContactState(c,now)}${c.technical?.verifiedAt?'（'+c.technical.verifiedAt.slice(0,10)+'）':''}`).join('\n');
  const conclusion=row.doNotContact?'已标记请勿联系':valid.length?'有验证通过的邮箱，人物归属仍需复核':emails.length?'有邮箱候选，尚不能确认可用':phones.length?'有个人号码，尚未拨测':profiles.length?'仅有个人主页，未找到邮箱和电话':'未找到个人联系方式';
  return {email:emails.map(c=>c.value).join('\n')||'未找到',emailState:emailState||'未找到个人邮箱',
    phone:phones.map(c=>`${c.kind==='whatsapp'?'WhatsApp：':''}${c.value}（未拨测）`).join('\n')||'未找到',
    profiles:profiles.join('\n')||'未找到',conclusion,hasEmail:emails.length>0,hasPhone:phones.length>0,hasProfile:profiles.length>0,hasValidEmail:valid.length>0};
}
