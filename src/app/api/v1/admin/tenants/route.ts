import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { identityDb } from "@/server/db";
import { principalFor, mutationOrigin, json, failure } from "@/server/http";
import { AccessError } from "@/server/policy";
async function admin(request: Request) {
  const user = await principalFor(request);
  if (user.platformRole !== "platform_admin" || !user.twoFactorEnabled) throw new AccessError("PLATFORM_ADMIN_REQUIRED", 403);
  return user;
}
export async function GET(request: Request) {
  try {
    const user = await admin(request);
    const rows = await identityDb().$queryRaw<Array<{ id: string; name: string; status: string; member_count: bigint; pause_status: string | null }>>`SELECT * FROM public.admin_tenants(${user.id})`;
    return json({ tenants: rows.map(row => ({ ...row, member_count: Number(row.member_count) })) });
  }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    mutationOrigin(request); const user = await admin(request);
    const body = z.object({ name: z.string().trim().min(1).max(100), email: z.string().email().max(254) }).parse(await request.json());
    const token = randomBytes(32).toString("hex"), hash = createHash("sha256").update(token).digest("hex");
    const rows = await identityDb().$queryRaw<Array<{ create_tenant: string }>>`SELECT public.create_tenant(${user.id},${body.name},${body.email},${hash})`;
    return json({ tenantId: rows[0].create_tenant, invitationUrl: `${process.env.BETTER_AUTH_URL}/invite#${token}` }, 201);
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    mutationOrigin(request); const user = await admin(request);
    const body = z.object({ tenantId: z.string().uuid(), action: z.literal("suspend") }).parse(await request.json());
    await identityDb().$executeRaw`SELECT public.suspend_tenant(${user.id},${body.tenantId})`;
    return json({ status: "suspended", providerPause: "pending" });
  } catch (error) { return failure(error); }
}
