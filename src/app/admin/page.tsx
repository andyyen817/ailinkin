"use client";
import { useEffect, useState, type FormEvent } from "react";
type Tenant = { id: string; name: string; status: string; member_count: number; pause_status: string | null };
export default function Admin() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [invitation, setInvitation] = useState("");
  const [events, setEvents] = useState<Array<{ action: string; created_at: string }>>([]);
  async function load() { const response = await fetch("/api/v1/admin/tenants"); if (!response.ok) throw Error(); setAllowed(true); setTenants((await response.json()).tenants); }
  useEffect(() => { load().catch(() => setMessage("需要已启用二次验证的平台管理员账号。")); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage(""); setInvitation("");
    try { const response = await fetch("/api/v1/admin/tenants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); if (!response.ok) throw Error(); setInvitation((await response.json()).invitationUrl); await load(); }
    catch { setMessage("企业开通未成功，请核对信息后重试。"); } finally { setBusy(false); }
  }
  async function suspend(tenantId: string) {
    if (busy) return; setBusy(true); setMessage("");
    try { const response = await fetch("/api/v1/admin/tenants", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId, action: "suspend" }) }); if (!response.ok) throw Error(); await load(); setMessage("企业已停用，第三方暂停请求待处理；尚未确认第三方已暂停。"); }
    catch { setMessage("停用未成功，请刷新确认当前状态。"); } finally { setBusy(false); }
  }
  async function support(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage(""); setEvents([]);
    const data = new FormData(event.currentTarget);
    try { const response = await fetch(`/api/v1/tenants/${encodeURIComponent(String(data.get("tenantId")))}/support?grantId=${encodeURIComponent(String(data.get("grantId")))}`); if (!response.ok) throw Error(); setEvents((await response.json()).events); }
    catch { setMessage("支持访问被拒绝，请检查企业、授权对象和有效期。"); } finally { setBusy(false); }
  }
  return <main className="workspace"><header><a className="brand" href="/workspace"><span className="brand-mark">L</span>平台管理</a><a className="text-link" href="/workspace">返回工作台</a></header><h1>邀请企业试用</h1><p className="muted">默认查看企业状态和人数。支持访问需要企业负责人单独授权。</p>{message && <div className="form-message" role="alert">{message}</div>}{allowed && <>
    <form className="login-form admin-form" onSubmit={create}><label htmlFor="tenant-name">企业名称</label><input id="tenant-name" name="name" required maxLength={100} /><label htmlFor="owner-email">负责人邮箱</label><input id="owner-email" name="email" type="email" required maxLength={254} /><button className="primary" disabled={busy}>创建企业及负责人邀请</button>{invitation && <a className="invitation-link" href={invitation}>负责人邀请链接（48 小时有效）</a>}</form>
    <h2>企业状态</h2><ul className="member-list">{tenants.map(tenant => <li key={tenant.id}><div><strong>{tenant.name}</strong><small>{tenant.member_count} 位成员 · {tenant.status === "active" ? "正常" : "已停用"}</small><small>企业编号：{tenant.id}</small>{tenant.pause_status && <small>{tenant.pause_status === "confirmed" ? "第三方已暂停" : "第三方暂停请求待处理"}</small>}</div>{tenant.status === "active" && <button disabled={busy} onClick={() => suspend(tenant.id)}>停用 {tenant.name}</button>}</li>)}</ul>
    <h2>读取已授权的审计记录</h2><form className="login-form admin-form" onSubmit={support}><label htmlFor="support-tenant">企业编号</label><input id="support-tenant" name="tenantId" required /><label htmlFor="grant-id">负责人提供的授权编号</label><input id="grant-id" name="grantId" required /><button className="primary" disabled={busy}>读取审计记录</button></form><ul className="member-list">{events.map((event,index)=><li key={`${event.created_at}-${index}`}>{event.action} · {new Date(event.created_at).toLocaleString("zh-CN")}</li>)}</ul>
  </>}</main>;
}
