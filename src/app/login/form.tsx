"use client";
import { useState, type FormEvent } from "react";

export function LoginForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password"), rememberMe: false }),
      });
      const result = await response.json();
      if (!response.ok) setMessage(response.status === 503 ? "登录服务尚未就绪，请联系管理员或稍后重试。" : "无法登录，请检查账号信息后重试。");
      else window.location.assign(result.twoFactorRedirect ? "/security/verify" : "/workspace");
    } catch { setMessage("暂时无法连接服务，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="login-form">
    <label htmlFor="email">企业邮箱</label>
    <input id="email" name="email" type="email" autoComplete="username" placeholder="name@company.com" required maxLength={254} />
    <label htmlFor="password">密码</label>
    <div className="password-field">
      <input id="password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" placeholder="请输入账号密码" required maxLength={128} />
      <button type="button" className="reveal" onClick={() => setVisible(!visible)} aria-label={visible ? "隐藏密码" : "显示密码"}>{visible ? "隐藏" : "显示"}</button>
    </div>
    <button className="primary" disabled={busy} type="submit">{busy ? "正在登录…" : "登录工作台"}<span aria-hidden="true">→</span></button>
    {message && <div className="form-message" role="alert">{message}</div>}
    <a className="text-link" href="/forgot-password">忘记密码</a>
  </form>;
}
