"use client";
import { useState, type FormEvent } from "react";
type Mode = "invite" | "forgot" | "reset" | "setup" | "verify";
export function AccountForm({ mode }: { mode: Mode }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [complete, setComplete] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    let endpoint = "", body: Record<string, unknown> = {};
    if (mode === "invite") { endpoint = "/api/v1/invitations/accept"; body = { ...data, token: location.hash.slice(1) }; }
    if (mode === "forgot") { endpoint = "/api/auth/request-password-reset"; body = { email: data.email, redirectTo: `${location.origin}/reset-password` }; }
    if (mode === "reset") { endpoint = "/api/auth/reset-password"; body = { newPassword: data.password, token: new URLSearchParams(location.search).get("token") }; }
    if (mode === "setup" && !secret) { endpoint = "/api/auth/two-factor/enable"; body = { password: data.password }; }
    if (mode === "verify" || (mode === "setup" && secret)) { endpoint = "/api/auth/two-factor/verify-totp"; body = { code: data.code, trustDevice: false }; }
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) { setMessage(mode === "invite" ? (result.message ?? "无法接受邀请，请检查链接或联系负责人。") : "操作未成功，请检查填写信息、链接有效期或服务配置后重试。"); return; }
      if (mode === "setup" && !secret) {
        setSecret(new URL(result.totpURI).searchParams.get("secret") ?? "");
        setBackupCodes(result.backupCodes ?? []); return;
      }
      if (mode === "verify" || mode === "setup") { window.location.assign("/workspace"); return; }
      setComplete(true);
      setMessage(mode === "forgot" ? "如果该邮箱可以找回密码，系统会发送重设链接，请检查收件箱。" : mode === "reset" ? "密码已更新，原登录会话已撤销。请重新登录。" : "邀请已接受，请使用企业邮箱和账号密码登录。");
      if (mode === "invite") history.replaceState(null, "", "/invite");
    } catch { setMessage("暂时无法连接服务，请稍后重试。"); }
    finally { setBusy(false); }
  }
  return <form className="login-form" onSubmit={submit}>
    {!complete && <>
      {mode === "invite" && <><label htmlFor="name">姓名</label><input id="name" name="name" required maxLength={100} autoComplete="name" /></>}
      {mode === "forgot" && <><label htmlFor="email">企业邮箱</label><input id="email" name="email" type="email" required maxLength={254} autoComplete="email" /></>}
      {(mode === "invite" || mode === "reset" || (mode === "setup" && !secret)) && <><label htmlFor="password">{mode === "setup" ? "当前账号密码" : "设置密码（至少 6 位）"}</label><input id="password" name="password" type="password" required minLength={mode === "setup" ? 1 : 6} maxLength={128} autoComplete={mode === "setup" ? "current-password" : "new-password"} /></>}
      {secret && <div className="security-secret"><p>在身份验证器中手动添加账号，输入以下密钥：</p><code>{secret}</code><p>请妥善保存以下备用恢复码，每个只能使用一次：</p><div className="backup-codes">{backupCodes.map(code => <code key={code}>{code}</code>)}</div><label className="check-label"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} required />我已保存恢复码</label></div>}
      {(mode === "verify" || secret) && <><label htmlFor="code">身份验证器中的 6 位验证码</label><input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required maxLength={6} /></>}
      <button className="primary" type="submit" disabled={busy}>{busy ? "正在处理…" : mode === "invite" ? "接受邀请" : mode === "forgot" ? "发送重设链接" : mode === "reset" ? "更新密码" : mode === "setup" && !secret ? "设置身份验证器" : "验证并继续"}</button>
    </>}
    {message && <div className="form-message" role="status">{message}</div>}
    <a className="text-link" href={mode === "setup" ? "/workspace" : "/login"}>{mode === "setup" ? "返回工作台" : "返回登录"}</a>
  </form>;
}
