import { getAuth } from "@/server/auth";
import { configurationPresent } from "@/server/policy";

export const dynamic = "force-dynamic";

async function handler(request: Request) {
  const path = new URL(request.url).pathname;
  if (path.includes("/sign-up/")) {
    return Response.json({ code: "INVITE_ONLY", message: "仅接受企业邀请，暂不开放注册。" }, { status: 403 });
  }
  if (!configurationPresent(process.env)) {
    return Response.json({ code: "SERVICE_UNAVAILABLE", message: "登录服务尚未配置，请联系管理员。" }, { status: 503 });
  }
  try { return await getAuth().handler(request); }
  catch { return Response.json({ code: "SERVICE_UNAVAILABLE", message: "登录服务暂时不可用，请稍后重试。" }, { status: 503 }); }
}

export const GET = handler;
export const POST = handler;
