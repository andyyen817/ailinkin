"use client";
import { useEffect, useState, type FormEvent } from "react";
type Member = { id: string; name: string; email: string; role: string; active: boolean };
export function MemberManagement({ tenantId }: { tenantId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [grantId, setGrantId] = useState("");
  const [grants, setGrants] = useState<Array<{ id: string; admin_email: string; reason: string; expires_at: string; revoked_at: string | null }>>([]);
  const base = `/api/v1/tenants/${tenantId}`;
  async function load() { const [response, support] = await Promise.all([fetch(`${base}/members`), fetch(`${base}/support`)]); if (!response.ok || !support.ok) throw Error(); setMembers((await response.json()).members); setGrants((await support.json()).grants); }
  useEffect(() => { load().catch(() => setMessage("无法读取成员，请刷新或检查权限。")); }, [tenantId]);
  async function disable(id: string) {
    if (busy) return; setBusy(true); setMessage("");
    try { const response = await fetch(`${base}/members`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ membershipId: id, action: "disable" }) }); if (!response.ok) throw Error(); await load(); setMessage("成员已停用，该成员将无法继续访问本企业。"); }
    catch { setMessage("成员停用未成功，请刷新后重试。"); } finally { setBusy(false); }
  }
  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage("");
    try { const response = await fetch(`${base}/support`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); if (!response.ok) throw Error(); setGrantId((await response.json()).grantId); await load(); setMessage("已授权该管理员只读查看本企业审计记录，有效期 1 小时。"); }
    catch { setMessage("授权未成功，请核对管理员账号和权限。"); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    if (busy) return; setBusy(true);
    try { const response = await fetch(`${base}/support`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grantId: id }) }); if (!response.ok) throw Error(); setGrantId(""); await load(); setMessage("支持访问授权已撤销。"); }
    catch { setMessage("撤销未成功，请重试。"); } finally { setBusy(false); }
  }
  return <section className="member-management"><h3>企业成员</h3><ul className="member-list">{members.map(member => <li key={member.id}><div><strong>{member.name}</strong><small>{member.email}</small><small>{member.role === "owner" ? "企业负责人" : member.active ? "销售成员" : "已停用"}</small></div>{member.role === "member" && member.active && <button disabled={busy} onClick={() => disable(member.id)}>停用 {member.name}</button>}</li>)}</ul>
    <h3>授权支持访问</h3><p className="muted">只读查看本企业审计记录，有效期 1 小时。客户资料和邮件内容尚未开放支持访问。</p><form className="login-form" onSubmit={grant}><label htmlFor="support-email">平台管理员邮箱</label><input id="support-email" name="email" type="email" required /><label htmlFor="support-reason">支持原因（至少 5 个字符）</label><input id="support-reason" name="reason" required minLength={5} maxLength={500} /><button className="primary" disabled={busy}>授权只读审计访问</button></form>
    {grantId && <p className="grant-result">授权编号：<code>{grantId}</code></p>}
    <ul className="member-list">{grants.map(item => <li key={item.id} data-grant-id={item.id}><div><strong>{item.admin_email}</strong><small>{item.reason}</small><small>授权编号：{item.id}</small><small>{item.revoked_at ? "已撤销" : `有效至 ${new Date(item.expires_at).toLocaleString("zh-CN")}`}</small></div>{!item.revoked_at && <button onClick={() => revoke(item.id)} disabled={busy}>撤销授权</button>}</li>)}</ul>
    {message && <div className="form-message" role="status">{message}</div>}</section>;
}
