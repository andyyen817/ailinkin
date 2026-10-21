import 'server-only';
import {traceEvidenceDescription} from './contact-trace-results';
import {emailContactState} from './personal-contact-summary';
export function enrichContactExcel(campaign:any,sheet:any){
  const batch=campaign.data.operatorBatches?.findLast((b:any)=>b.mode==='people_enrichment');if(!batch)return;
  sheet.headers.splice(8,0,'邮箱归属','其他社交账号','社交账号归属','归属证据网址','核查日期');sheet.widths.splice(8,0,32,40,32,48,25);
  if(sheet.decisionColumn)sheet.decisionColumn+=5;if(sheet.linkColumn)sheet.linkColumn+=5;
  for(const row of sheet.rows){
    const matches=batch.people.filter((p:any)=>p.name===row[1]&&p.companyName===row[0]),p=matches.length===1?matches[0]:null;
    if(!p){row.splice(8,0,'未覆盖','','','','');continue;}
    const emails=p.emailCandidates||[],accounts=p.otherAccounts||[],evidence=[...(p.ownershipEvidence||[]),...emails.flatMap((c:any)=>c.evidence||[]),...accounts.flatMap((a:any)=>a.evidence||[])];
    row[2]=p.status;row[7]=p.reason;
    if(batch.traceMethod==='trace_v2'){
      const technicalState=emailContactState({technical:p.technical});
      row[3]=p.email||'尚未取得';row[4]=technicalState==='技术验证通过'?'技术验证通过（有独立回执）':p.email?p.technical?'候选／'+technicalState:'候选／尚未独立验真':'尚未取得';
      row[7]=[p.reason,p.traceReason].filter(Boolean).join('\n');
    }
    row.splice(8,0,p.ownershipState||'尚未核实',accounts.map((a:any)=>a.value).join('\n')||'本轮未取得',accounts.map((a:any)=>`${a.value}：${a.confirmed?'已核实本人':'候选待核'}`).join('\n')||'尚未核实',
      [...new Set(evidence.map((e:any)=>e.sourceUrl))].join('\n')||'暂无证据',evidence.map((e:any)=>e.retrievedAt).filter(Boolean).sort().at(-1)||'未取得');
    if(batch.traceMethod==='trace_v2')row.push(evidence.filter((e:any)=>e.sourceType!=='provider_receipt').map(traceEvidenceDescription).join('\n')||'尚无公开正文归属证据',p.emailCandidates?.some((c:any)=>c.confirmed)?'先查看本人邮箱证据及验证状态':accounts.some((a:any)=>a.confirmed)?'打开已确认的本人其他账号':p.profileUrl?'可打开LinkedIn主页；其余渠道待补全':'暂无确认的个人联系入口');
  }
  if(batch.traceMethod==='trace_v2'){sheet.headers.push('公开归属原文及PDF页码','建议联系入口');sheet.widths.push(70,36);}
}
