import { AccountForm } from "../components/account-form";
import { AccountShell } from "../components/account-shell";
export default function Page() { return <AccountShell title="设置新密码" description="重设链接有效期为 30 分钟。成功后需要重新登录。"><AccountForm mode="reset" /></AccountShell>; }
