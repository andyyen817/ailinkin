import { AccountForm } from "../../components/account-form";
import { AccountShell } from "../../components/account-shell";
export default function Page() { return <AccountShell title="二次验证（可选）" description="企业账号使用邮箱和密码即可登录。需要额外保护时，可在这里启用身份验证器；也可以直接返回工作台。"><AccountForm mode="setup" /></AccountShell>; }
