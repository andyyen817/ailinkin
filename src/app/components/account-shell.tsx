import type { ReactNode } from "react";
export function AccountShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="account-shell"><a className="brand" href="/login"><span className="brand-mark">L</span>AI 领英搜索助手</a><section className="account-card"><h1>{title}</h1><p className="muted">{description}</p>{children}</section></main>;
}
