import { LoginForm } from "./form";

export default function LoginPage() {
  return <main className="login-shell">
    <section className="intro" aria-label="产品介绍">
      <a className="brand" href="/login"><span className="brand-mark">L</span> AI 领英搜索助手</a>
      <div className="intro-main">
        <span className="eyebrow">为每一次有价值的联系做好准备</span>
        <h1>找到合适的客户，<br />开启更好的对话。</h1>
        <p>从目标客户画像到个性化开发信，<br />让团队在一个工作台里协作。</p>
        <ol className="workflow">
          <li><span>01</span><div><strong>明确目标</strong><small>按产品、市场和采购角色建立客户画像</small></div></li>
          <li><span>02</span><div><strong>理解客户</strong><small>整理客户资料，查看匹配依据与不确定项</small></div></li>
          <li><span>03</span><div><strong>审核与跟进</strong><small>确认内容和日程，再开启企业邮件活动</small></div></li>
        </ol>
      </div>
      <footer>多行业客户开发 · 企业独立工作空间</footer>
    </section>
    <section className="login-panel" aria-labelledby="login-title">
      <div className="login-card">
        <span className="badge"><span /> 企业邀请制试用</span>
        <h2 id="login-title">欢迎回到工作台</h2>
        <p className="muted">使用管理员邀请的企业账号登录。</p>
        <LoginForm />
        <div className="invite-note"><strong>还没有企业账号？</strong><p>请联系企业负责人获取邀请。当前暂不开放公共注册。</p></div>
        <p className="footnote">请勿在此输入领英账号或领英密码。</p>
      </div>
    </section>
  </main>;
}
