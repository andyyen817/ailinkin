import { AccountForm } from "../components/account-form";
import { AccountShell } from "../components/account-shell";
export default function Page() { return <AccountShell title="找回密码" description="填写受邀加入企业时使用的邮箱，我们会发送密码重设链接。"><AccountForm mode="forgot" /></AccountShell>; }
