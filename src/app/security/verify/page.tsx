import { AccountForm } from "../../components/account-form";
import { AccountShell } from "../../components/account-shell";
export default function Page() { return <AccountShell title="确认是你本人" description="打开身份验证器，输入当前验证码完成登录。"><AccountForm mode="verify" /></AccountShell>; }
