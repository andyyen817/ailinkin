import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeTenant, assertOrigin, configurationPresent, tenantObjectKey } from "../src/server/policy";

const input = () => ({
  principal: { id: "user-a", disabled: false, twoFactorEnabled: true, platformRole: "user" },
  tenant: { id: "tenant-a", status: "active" },
  membership: { tenantId: "tenant-a", userId: "user-a", role: "owner", active: true },
  requestedTenantId: "tenant-a",
});

test("owner with MFA receives only requested tenant context", () => {
  assert.deepEqual(authorizeTenant(input()), { userId: "user-a", tenantId: "tenant-a", role: "owner" });
});
test("cross-tenant membership cannot grant access", () => {
  const request = input(); request.membership.tenantId = "tenant-b";
  assert.throws(() => authorizeTenant(request), /TENANT_ACCESS_DENIED/);
});
test("another user's membership cannot grant access", () => {
  const request = input(); request.membership.userId = "user-b";
  assert.throws(() => authorizeTenant(request), /TENANT_ACCESS_DENIED/);
});
test("platform administrator has no implicit customer-data privilege", () => {
  const request = input(); request.principal.platformRole = "platform_admin";
  assert.throws(() => authorizeTenant({ ...request, membership: null }), /TENANT_ACCESS_DENIED/);
});
test("tenant suspension immediately denies access", () => {
  const request = input(); request.tenant.status = "suspended";
  assert.throws(() => authorizeTenant(request), /TENANT_UNAVAILABLE/);
});
test("disabled user is rejected even with a previously valid session", () => {
  const request = input(); request.principal.disabled = true;
  assert.throws(() => authorizeTenant(request), /ACCOUNT_DISABLED/);
});
test("ordinary owner can use business routes with password-only login", () => {
  const request = input(); request.principal.twoFactorEnabled = false;
  assert.deepEqual(authorizeTenant({ ...request, ownerOnly: true }), { userId: "user-a", tenantId: "tenant-a", role: "owner" });
});

test("platform administrator still requires MFA with explicit membership", () => {
  const request = input(); request.principal.twoFactorEnabled = false; request.principal.platformRole = "platform_admin";
  assert.throws(() => authorizeTenant(request), /MFA_REQUIRED/);
});
test("member cannot approve owner-only operations", () => {
  const request = input(); request.membership.role = "member";
  assert.throws(() => authorizeTenant({ ...request, ownerOnly: true }), /OWNER_REQUIRED/);
});
test("unknown roles and inactive memberships fail closed", () => {
  const request = input(); request.membership.role = "superuser";
  assert.throws(() => authorizeTenant(request), /ROLE_INVALID/);
  request.membership.role = "member"; request.membership.active = false;
  assert.throws(() => authorizeTenant(request), /TENANT_ACCESS_DENIED/);
});
test("same-origin mutation guard rejects absent, foreign and prefix-match origins", () => {
  assert.doesNotThrow(() => assertOrigin("https://app.example.com", "https://app.example.com"));
  for (const origin of [null, "https://evil.example.com", "https://app.example.com.evil.test"]) {
    assert.throws(() => assertOrigin(origin, "https://app.example.com"), /ORIGIN_DENIED/);
  }
});
test("object keys stay tenant scoped and reject traversal", () => {
  const context = authorizeTenant(input());
  assert.equal(tenantObjectKey(context, "exports", "file-1"), "tenants/tenant-a/exports/file-1");
  assert.throws(() => tenantObjectKey(context, "exports", "../tenant-b"), /OBJECT_KEY_INVALID/);
});
test("missing authentication configuration never enables service", () => {
  assert.equal(configurationPresent({}), false);
  assert.equal(configurationPresent({ DATABASE_URL: "postgresql://example", AUTH_DATABASE_URL: "postgresql://example", BETTER_AUTH_URL: "https://example.com", BETTER_AUTH_SECRET: "short" }), false);
});
