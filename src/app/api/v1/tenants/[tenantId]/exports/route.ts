import { createHash } from "node:crypto";
import { z } from "zod";
import { withTenant } from "@/server/tenant";
import { mutationOrigin, json, failure } from "@/server/http";
export async function GET(request: Request, route: { params: Promise<{ tenantId: string }> }) {
  try { const { tenantId } = await route.params;
    const kind=z.enum(['audit_export','contact_export']).parse(new URL(request.url).searchParams.get('kind')??'audit_export');
    return json({ jobs: await withTenant(request, tenantId, tx => tx.tenantJob.findMany({ where: { kind }, orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, state: true, attempts: true, createdAt: true, lastError: true, exportFile: { select: { id: true, expiresAt: true } } } }), true) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, route: { params: Promise<{ tenantId: string }> }) {
  try {
    mutationOrigin(request); const { tenantId } = await route.params;
    const key = z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/).parse(request.headers.get("idempotency-key"));
    const {kind}=z.object({ kind: z.enum(['audit_export','contact_export']) }).strict().parse(await request.json());
    const digest = createHash("sha256").update(`${kind}:v1`).digest("hex");
    const rows = await withTenant(request, tenantId, tx => kind==='contact_export'?tx.$queryRaw<Array<{queue_export:string}>>`SELECT public.queue_contact_export(${key},${digest}) AS queue_export`:tx.$queryRaw<Array<{ queue_export: string }>>`SELECT public.queue_export(${key},${digest})`, true);
    return json({ jobId: rows[0].queue_export }, 202);
  } catch (error) { return failure(error); }
}
