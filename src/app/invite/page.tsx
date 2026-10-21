import { AccountForm } from "../components/account-form";
import { AccountShell } from "../components/account-shell";
export default function Page() { return <AccountShell title="加入企业工作空间" description="使用负责人提供的邀请创建账号。已有账号请先登录，再打开原邀请链接。"><AccountForm mode="invite" /></AccountShell>; }
