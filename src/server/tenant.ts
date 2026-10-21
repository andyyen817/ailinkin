import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { businessDb, identityDb } from "./db";
import { getAuth } from "./auth";
import { AccessError, authorizeTenant, type TenantContext } from "./policy";

export async function withTenant<T>(request: Request, tenantId: string,
  work: (tx: Prisma.TransactionClient, context: TenantContext) => Promise<T>, ownerOnly = false, timeoutMs: 5000 | 30000 = 5000) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw new AccessError("AUTH_REQUIRED", 401);
  const principal = await identityDb().user.findUnique({ where: { id: session.user.id } });
  if (!principal || principal.disabled) throw new AccessError("ACCOUNT_DISABLED", 403);
  return businessDb().$transaction(async tx => {
    // Transaction-local context prevents pooled connections retaining another tenant.
    await tx.$executeRaw`SELECT set_config('app.user_id', ${principal.id}, true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    const membership = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: principal.id } } });
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    const context = authorizeTenant({ principal, tenant, membership, requestedTenantId: tenantId, ownerOnly });
    return work(tx, context);
  }, { timeout: timeoutMs });
}
