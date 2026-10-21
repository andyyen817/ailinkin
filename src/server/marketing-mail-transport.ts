import 'server-only';
import fs from 'node:fs/promises';
import nodemailer from 'nodemailer';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {normalizeEmailCheck} from './person-email-provider';
const connectionSchema=z.object({tenantId:z.uuid(),email:z.email(),host:z.string().regex(/^[a-zA-Z0-9.-]+$/),port:z.union([z.literal(465),z.literal(587)]),
  username:z.string().min(1).max(200),passwordEnv:z.string().regex(/^MARKETING_[A-Z0-9_]+$/),gmailTokenEnv:z.string().regex(/^MARKETING_[A-Z0-9_]+$/).optional()}).strict();
export async function readMarketingConnection(tenantId:string){
  try{const list=z.array(connectionSchema).parse(JSON.parse(await fs.readFile(/* turbopackIgnore: true */ process.env.MARKETING_CONNECTIONS_PATH||'.runtime/marketing-connections.json','utf8')));
    const row=list.find(c=>c.tenantId===tenantId);return row&&process.env[row.passwordEnv]?{...row,password:process.env[row.passwordEnv]!}:null;
  }catch{return null;}
}
export async function hunterVerify(email:string,key:string,requestKey:string,fetcher:typeof fetch=fetch){
  if(!key||key==='test-api-key')throw Error('REAL_VERIFICATION_PROVIDER_REQUIRED');
  const response=await fetcher('https://api.hunter.io/v2/email-verifier?email='+encodeURIComponent(email),{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(response.status===202)return {pending:true};if(!response.ok)throw Error('EMAIL_VERIFICATION_HTTP_'+response.status);
  const raw=await response.json();if(raw.data?.email?.toLowerCase()!==email.toLowerCase())throw Error('EMAIL_VERIFICATION_ADDRESS_MISMATCH');
  const check=normalizeEmailCheck(email,raw),status=['valid','invalid','catch_all'].includes(check.status)?check.status:'unknown';
  return {pending:false,email,status,source:'https://api.hunter.io/v2/email-verifier',providerRequestKey:requestKey,raw,
    checkedAt:check.verifiedAt||check.requestedAt,expiresAt:check.expiresAt||check.requestedAt,providerVerifiedAt:check.verifiedAt,requestedAt:check.requestedAt};
}
export async function smtpMarketingSend(connection:NonNullable<Awaited<ReturnType<typeof readMarketingConnection>>>,message:any){
  const transport=nodemailer.createTransport({host:connection.host,port:connection.port,secure:connection.port===465,requireTLS:true,
    tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},auth:{user:connection.username,pass:connection.password},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});
  try{const result=await transport.sendMail({from:{name:message.sender.name,address:connection.email},to:message.email,subject:message.subject,text:message.body,messageId:message.messageId});
    if(!result.accepted?.some(v=>String(v).toLowerCase()===message.email.toLowerCase()))throw Error('SMTP_ACCEPTANCE_UNKNOWN');
    return {messageId:result.messageId,accepted:true,meaning:'SMTP已接受；不代表客户已阅读或已投递到收件箱'};
  }finally{transport.close();}
}
export async function gmailReplies(connection:NonNullable<Awaited<ReturnType<typeof readMarketingConnection>>>,messageId:string,fetcher:typeof fetch=fetch){
  const token=connection.gmailTokenEnv&&process.env[connection.gmailTokenEnv];if(!token)throw Error('REPLY_MAILBOX_NOT_CONNECTED');
  const get=async(url:string)=>{const r=await fetcher(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('REPLY_READ_HTTP_'+r.status);return r.json();};
  const lookup=await get('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q='+encodeURIComponent('rfc822msgid:'+messageId));
  const replies:any[]=[];for(const found of lookup.messages||[]){if(!/^[a-f0-9]+$/.test(found.id))continue;
    const message=await get('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+found.id+'?format=metadata');if(!/^[a-f0-9]+$/.test(message.threadId||''))continue;
    const thread=await get('https://gmail.googleapis.com/gmail/v1/users/me/threads/'+message.threadId+'?format=metadata');
    for(const m of thread.messages||[]){const headers=m.payload?.headers||[],header=(name:string)=>headers.find((h:any)=>h.name.toLowerCase()===name.toLowerCase())?.value||'';
      if(header('From').toLowerCase().includes(connection.email.toLowerCase()))continue;
      if(header('Auto-Submitted')&&header('Auto-Submitted')!=='no')continue;
      replies.push({id:m.id,from:header('From'),date:header('Date'),subject:header('Subject'),snippet:m.snippet||'',source:'gmail_thread',contentHash:createHash('sha256').update(JSON.stringify(m)).digest('hex')});
    }
  }
  return [...new Map(replies.map(r=>[r.id,r])).values()];
}
