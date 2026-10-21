import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 领英搜索助手 · 企业工作台",
  description: "面向多行业外贸团队的客户开发工作台",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
