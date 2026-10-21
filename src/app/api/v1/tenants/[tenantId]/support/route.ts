import { z } from "zod";
import { withTenant } from "@/server/tenant";
import { identityDb } from "@/server/db";
import { principalFor, mutationOrigin, json, failure } from "@/server/http";
import { AccessError } from "@/server/policy";
export async function POST(request: Request, route: { params: Promise<{ tenantId: string }> }) {
  try {
    mutationOrigin(request); const { tenantId } = await route.params;
    const body = z.object({ email: z.string().email(), reason: z.string().trim().min(5).max(500) }).parse(await request.json());
    const rows = await withTenant(request, tenantId, tx => tx.$queryRaw<Array<{ grant_support: string }>>`SELECT public.grant_support(${body.email},${body.reason})`, true);
    return json({ grantId: rows[0].grant_support, expiresInHours: 1, scope: "audit_read" }, 201);
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, route: { params: Promise<{ tenantId: string }> }) {
  try {
    mutationOrigin(request); const { tenantId } = await route.params;
    const { grantId } = z.object({ grantId: z.string().uuid() }).parse(await request.json());
    await withTenant(request, tenantId, tx => tx.$executeRaw`SELECT public.revoke_support(${grantId})`, true);
    return json({ revoked: true });
  } catch (error) { return failure(error); }
}
export async function GET(request: Request, route: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await route.params;
    if (!new URL(request.url).searchParams.has("grantId")) {
      return json({ grants: await withTenant(request, tenantId, tx => tx.$queryRaw`SELECT * FROM public.tenant_support_grants()`, true) });
    }
    const user = await principalFor(request);
    if (user.platformRole !== "platform_admin" || !user.twoFactorEnabled) throw new AccessError("SUPPORT_ACCESS_DENIED", 403);
    const grantId = z.string().uuid().parse(new URL(request.url).searchParams.get("grantId"));
    try { return json({ events: await identityDb().$queryRaw`SELECT * FROM public.support_audit(${user.id},${tenantId},${grantId})` }); }
    catch { throw new AccessError("SUPPORT_ACCESS_DENIED", 403); }
  } catch (error) { return failure(error); }
}
