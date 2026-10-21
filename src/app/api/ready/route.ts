import { configurationPresent } from "@/server/policy";
import { businessDb, identityDb } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!configurationPresent(process.env)) return Response.json({ status: "not_ready" }, { status: 503 });
  try {
    const roleGroups = await Promise.all([
      businessDb().$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      identityDb().$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    ]);
    if (roleGroups.some(roles => roles.length !== 1 || roles[0].rolsuper || roles[0].rolbypassrls)) {
      return Response.json({ status: "unsafe_database_role" }, { status: 503 });
    }
    const policies = await businessDb().$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relname IN ('tenant', 'membership', 'invitation', 'audit_log', 'support_grant', 'tenant_pause_request', 'tenant_job', 'export_file')`;
    if (policies.length !== 8 || policies.some(table => !table.relrowsecurity || !table.relforcerowsecurity)) {
      return Response.json({ status: "tenant_isolation_not_ready" }, { status: 503 });
    }
    await identityDb().user.count();
    return Response.json({ status: "ready", scope: "identity_database" });
  } catch { return Response.json({ status: "not_ready" }, { status: 503 }); }
}
