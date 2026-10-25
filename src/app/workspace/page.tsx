"use client";
import { useEffect, useState, type FormEvent } from "react";
import { MemberManagement } from "../components/member-management";
import { AuditExports } from "../components/audit-exports";
import "../prospecting/prospecting.css";
type Membership = { tenant_id: string; name: string; role: string; status: string };
type Profile = { user: { name: string; twoFactorEnabled: boolean; platformRole: string }; memberships: Membership[] };
export default function Workspace() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<Membership | null>(null);
  const [message, setMessage] = useState("");
  const [invitation, setInvitation] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let current = true; fetch("/api/v1/me").then(async response => {
    if (response.status === 401) { location.assign("/login"); return; }
    if (!response.ok) throw Error();
    const data = await response.json(); if (current) setProfile(data);
  }).catch(() => { if (current) setMessage("账号暂时无法访问，请重新登录或联系管理员。"); }); return () => { current = false; }; }, []);
  async function open(membership: Membership) {
    if (busy) return; setBusy(true); setMessage(""); setSelected(null); setInvitation("");
    try {
      const response = await fetch(`/api/v1/tenants/${membership.tenant_id}`);
      const result = await response.json();
      if (!response.ok) { setMessage(result.error === "MFA_REQUIRED" ? "平台管理账号需要先完成二次验证设置。" : "该企业目前无法访问，请联系管理员。"); return; }
      setSelected(membership);
    } catch { setMessage("暂时无法连接服务。"); } finally { setBusy(false); }
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !selected) return; setBusy(true); setMessage(""); setInvitation("");
    const email = new FormData(event.currentTarget).get("email");
    try {
      const response = await fetch(`/api/v1/tenants/${selected.tenant_id}/invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json();
      if (!response.ok) { setMessage("暂时无法创建邀请，请检查企业名额、重复邀请和账号权限。"); return; }
      setInvitation(result.invitationUrl);
    } catch { setMessage("暂时无法连接服务。"); } finally { setBusy(false); }
  }
  async function logout() { const response = await fetch("/api/auth/sign-out", { method:"POST", headers:{"Content-Type":"application/json"}, body:"{}" }); if(response.ok) location.assign("/login"); else setMessage("退出未成功，请重试。"); }
  return <main className="workspace"><header><a className="brand" href="/workspace"><span className="brand-mark">L</span>企业工作台</a><nav><a href="/security/setup">账号安全</a><button onClick={logout}>退出登录</button></nav></header>
    <section className="workspace-intro"><span className="eyebrow">客户开发工作台</span><h1>{profile ? "今天，找哪些客户？" : message ? "暂时无法访问工作台" : "正在读取账号…"}</h1><p className="muted">先告诉系统产品、地区和客户类型，再审核联系人并下载。当前暂不发信。</p></section>
    {message && <div className="form-message" role="alert">{message}</div>}
    {profile?.user.platformRole === "platform_admin" && !profile.user.twoFactorEnabled && <p className="security-note">平台管理账号需要启用二次验证。<a className="text-link" href="/security/setup">设置身份验证器 →</a></p>}
    <div className="tenant-grid">{profile?.memberships.map(membership => <article className="tenant-card" key={membership.tenant_id}><span className="badge">{membership.status === "active" ? "可访问" : "已停用"}</span><h2>{membership.name}</h2><p>{membership.role === "owner" ? "企业负责人" : "销售成员"}</p>{membership.status === "active" && <div className="novice-actions"><a className="primary" href={`/prospecting?tenantId=${membership.tenant_id}`}>开始找客户 →</a><a className="novice-secondary" href={`/contacts?tenantId=${membership.tenant_id}`}>客户库与下载</a><button className="novice-text" onClick={() => open(membership)} disabled={busy}>企业设置与成员</button></div>}</article>)}</div>
    {profile?.user.platformRole === "platform_admin" && <p><a className="text-link" href="/admin">管理试用企业 →</a></p>}
    {profile?.memberships.length === 0 && <p>当前没有可用的企业成员身份，请联系企业负责人。</p>}
    {selected && <section className="workspace-detail"><h2>{selected.name}</h2><p>已进入企业工作空间，可以建立搜索任务并查看客户研究进度。</p>{selected.role === "owner" && <form className="login-form" onSubmit={invite}><label htmlFor="invite-email">邀请销售成员</label><input id="invite-email" name="email" type="email" required maxLength={254} placeholder="name@company.com" /><button className="primary" disabled={busy}>创建 48 小时邀请链接</button>{invitation && <div className="form-message"><p>请通过企业认可的渠道将链接发给受邀人：</p><a className="invitation-link" href={invitation}>{invitation}</a></div>}</form>}</section>}
    {selected && <details className="novice-advanced"><summary>产品资料与高级研究</summary><p><a className="text-link" href={`/profiles?tenantId=${selected.tenant_id}`}>维护产品资料与客户画像 →</a></p><p><a className="text-link" href={`/search?tenantId=${selected.tenant_id}`}>打开高级搜索与研究 →</a></p></details>}
    {selected?.role === "owner" && <MemberManagement key={selected.tenant_id} tenantId={selected.tenant_id} />}
    {selected?.role === "owner" && <AuditExports key={`export-${selected.tenant_id}`} tenantId={selected.tenant_id} />}
  </main>;
}
