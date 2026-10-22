"use client";
import { useEffect, useRef, useState } from "react";
import { retrieveExport } from "@/domain/export-download";
type Job = { id: string; state: string; attempts: number; createdAt: string; exportFile: { id: string; expiresAt: string } | null };
const labels: Record<string,string> = {pending:"排队中",running:"生成中",succeeded:"可下载",failed:"生成失败",cancelled:"已取消"};
export function AuditExports({tenantId,kind='audit_export'}:{tenantId:string;kind?:'audit_export'|'contact_export'}) {
  const [jobs,setJobs]=useState<Job[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const key=useRef<string | null>(null);
  const base=`/api/v1/tenants/${tenantId}/exports`;
  const listing=`${base}?kind=${kind}`;
  async function load(){const response=await fetch(listing);if(!response.ok)throw Error();setJobs((await response.json()).jobs);}
  useEffect(()=>{let current=true;const update=async()=>{try{const response=await fetch(listing);if(!response.ok)throw Error();const data=await response.json();if(current)setJobs(data.jobs);}catch{if(current)setMessage("暂时无法读取导出任务，请稍后刷新。");}};void update();const timer=setInterval(update,2000);return()=>{current=false;clearInterval(timer);};},[listing]);
  async function create(){if(busy)return;setBusy(true);setMessage("");key.current??=crypto.randomUUID();try{const response=await fetch(base,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key.current},body:JSON.stringify({kind})});if(!response.ok)throw Error();key.current=null;await load();}catch{setMessage("导出提交未确认，请重试。重试会使用同一个请求编号。");}finally{setBusy(false);}}
  async function download(id:string){
    if(busy)return;setBusy(true);setMessage("");
    try{
      const path=`${base}/${id}/download`;
      const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      if(!response.ok)throw Error('DOWNLOAD_HTTP_'+response.status);
      const result=await response.json();
      const blob=await retrieveExport(result.url,path,window.location.origin);
      const url=URL.createObjectURL(blob),anchor=document.createElement("a");
      anchor.href=url;anchor.download=kind==="contact_export"?"contacts.csv":"audit.csv";
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch(error){
      const code=error instanceof Error&&/^DOWNLOAD_HTTP_\d{3}$/.test(error.message)?`（${error.message.slice(-3)}）`:"";
      setMessage(`无法下载${code}，请检查文件有效期或账号权限后重试。`);
    }finally{setBusy(false);}
  }
  return <section className="member-management"><h3>{kind==="contact_export"?"导出客户 CSV":"导出企业审计记录"}</h3><p className="muted">{kind==="contact_export"?"导出本企业全部客户，最多 10,000 行且文件不超过 1 MiB，超过时任务失败。文件保存 7 天，每次下载链接有效 60 秒。":"导出最近 1000 条操作类型和时间，不包含客户内容。文件保存 7 天，每次下载链接有效 60 秒。"}</p><button className="primary" disabled={busy} onClick={create}>{kind==="contact_export"?"生成客户 CSV":"生成审计 CSV"}</button>{message&&<div className="form-message" role="status">{message}</div>}<ul className="member-list">{jobs.map(job=><li key={job.id} data-job-id={job.id}><div><strong>{labels[job.state]??job.state}</strong><small>{new Date(job.createdAt).toLocaleString("zh-CN")}</small></div>{job.state==="succeeded"&&job.exportFile&&<button disabled={busy} onClick={()=>download(job.exportFile!.id)}>下载 CSV</button>}</li>)}</ul></section>;
}
