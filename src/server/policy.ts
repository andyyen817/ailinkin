export class AccessError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}

export type Principal = { id: string; disabled: boolean; twoFactorEnabled: boolean; platformRole: string };
export type TenantContext = { tenantId: string; userId: string; role: "owner" | "member" };

export function authorizeTenant(input: {
  principal: Principal;
  tenant: { id: string; status: string } | null;
  membership: { tenantId: string; userId: string; role: string; active: boolean } | null;
  requestedTenantId: string;
  ownerOnly?: boolean;
}): TenantContext {
  const { principal, membership, tenant, requestedTenantId } = input;
  if (principal.disabled) throw new AccessError("ACCOUNT_DISABLED", 403);
  if (!tenant || tenant.id !== requestedTenantId || tenant.status !== "active") throw new AccessError("TENANT_UNAVAILABLE", 403);
  // Platform administration is never an implicit customer-data access grant.
  if (!membership || !membership.active || membership.tenantId !== tenant.id || membership.userId !== principal.id) {
    throw new AccessError("TENANT_ACCESS_DENIED", 403);
  }
  if (membership.role !== "owner" && membership.role !== "member") throw new AccessError("ROLE_INVALID", 403);
  if (principal.platformRole === "platform_admin" && !principal.twoFactorEnabled) {
    throw new AccessError("MFA_REQUIRED", 403);
  }
  if (input.ownerOnly && membership.role !== "owner") throw new AccessError("OWNER_REQUIRED", 403);
  return { tenantId: tenant.id, userId: principal.id, role: membership.role };
}

export function assertOrigin(origin: string | null, trustedUrl: string) {
  if (!origin || origin !== new URL(trustedUrl).origin) throw new AccessError("ORIGIN_DENIED", 403);
}

export function tenantObjectKey(context: TenantContext, kind: "imports" | "exports", objectId: string) {
  const safe = /^[a-zA-Z0-9_-]+$/;
  if (!safe.test(context.tenantId) || !safe.test(objectId)) throw new AccessError("OBJECT_KEY_INVALID", 400);
  return `tenants/${context.tenantId}/${kind}/${objectId}`;
}

export function configurationPresent(env: Record<string, string | undefined>) {
  return Boolean(env.DATABASE_URL && env.AUTH_DATABASE_URL && env.BETTER_AUTH_URL &&
    env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length >= 32);
}
