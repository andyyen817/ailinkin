import "server-only";
import nodemailer from "nodemailer";

export async function sendPasswordReset(to: string, url: string) {
  if (process.env.MAIL_SENDING_ENABLED === 'false') throw Error('MAIL_SENDING_DISABLED');
  const local = process.env.LOCAL_SMTP_TEST === "true";
  if (local && (process.env.SMTP_HOST !== "127.0.0.1" || !to.endsWith("@example.invalid"))) throw Error("LOCAL_MAIL_BOUNDARY");
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) throw Error("RESET_MAIL_NOT_CONFIGURED");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 465),
    secure: !local, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
    auth: local ? undefined : { user: process.env.SMTP_USER ?? "", pass: process.env.SMTP_PASSWORD ?? "" },
  });
  await transport.sendMail({ from: process.env.SMTP_FROM, to, subject: "重设 AI 领英搜索助手密码", textEncoding: "base64",
    text: `您申请重设账号密码。请在 30 分钟内打开以下链接：\n${url}\n\n如果不是您本人申请，请忽略此邮件。` });
}
