import { z } from "zod";
import { createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { identityDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { mutationOrigin, json, failure } from "@/server/http";
const input = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().trim().min(1).max(100), password: z.string().min(6).max(128) });
export async function POST(request: Request) {
  try {
    mutationOrigin(request);
    const body = input.parse(await request.json());
    const tokenHash = createHash("sha256").update(body.token).digest("hex");
    // Bound expensive password hashing even for invalid tokens. No client-supplied IP trust.
    const key = `invitation:${Math.floor(Date.now() / 60000)}`;
    const budget = await identityDb().rateLimit.upsert({ where: { key }, create: { id: key, key, count: 1, lastRequest: BigInt(Date.now()) }, update: { count: { increment: 1 } } });
    if (budget.count > 20) return json({ error: "RATE_LIMITED" }, 429);
    const session = await getAuth().api.getSession({ headers: request.headers });
    const password = await hashPassword(body.password);
    try {
      await identityDb().$queryRaw`SELECT public.accept_invitation(${tokenHash}, ${body.name}, ${password}, ${session?.user.id ?? null})`;
    } catch { return json({ error: "INVITATION_UNAVAILABLE", message: "邀请已失效、名额已满或邮箱已有账号。已有账号请先登录，再打开邀请；其他情况请联系负责人。" }, 409); }
    return json({ accepted: true });
  } catch (error) { return failure(error); }
}
