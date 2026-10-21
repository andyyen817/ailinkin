import { createHash } from "node:crypto";
import { withTenant } from "@/server/tenant";
import { mutationOrigin, json, failure } from "@/server/http";
import { AccessError } from "@/server/policy";
import { signDownload, verifyDownload } from "@/server/download-token";
import { readExport } from "@/server/storage";
type Route = { params: Promise<{ tenantId: string; id: string }> };
export async function POST(request: Request, route: Route) {
  try {
    mutationOrigin(request); const { tenantId, id } = await route.params;
    const signed = await withTenant(request, tenantId, async (tx, context) => {
      const file = await tx.exportFile.findUnique({ where: { id } });
      if (!file || file.tenantId !== tenantId || file.expiresAt.getTime() <= Date.now()) throw new AccessError("EXPORT_UNAVAILABLE", 404);
      return signDownload(tenantId, context.userId, file.id);
    }, true);
    return json({ url: `/api/v1/tenants/${tenantId}/exports/${id}/download?expires=${signed.expires}&signature=${signed.signature}`, expiresInSeconds: 60 });
  } catch (error) { return failure(error); }
}
export async function GET(request: Request, route: Route) {
  try {
    const { tenantId, id } = await route.params; const url = new URL(request.url);
    const file = await withTenant(request, tenantId, async (tx, context) => {
      verifyDownload(tenantId, context.userId, id, Number(url.searchParams.get("expires")), url.searchParams.get("signature") ?? "");
      const file = await tx.exportFile.findUnique({ where: { id } });
      if (!file || file.tenantId !== tenantId || file.expiresAt.getTime() <= Date.now() || file.objectKey !== `tenants/${tenantId}/exports/${id}`) throw new AccessError("EXPORT_UNAVAILABLE", 404);
      return file;
    }, true);
    const body = await readExport(file.objectKey);
    if (body.length !== file.size || createHash("sha256").update(body).digest("hex") !== file.sha256) throw Error("EXPORT_INTEGRITY_FAILED");
    // Recheck after object retrieval so revocation during network I/O is honored.
    await withTenant(request, tenantId, async tx => {
      const current = await tx.exportFile.findUnique({ where: { id } });
      if (!current || current.sha256 !== file.sha256 || current.expiresAt.getTime() <= Date.now()) throw new AccessError("EXPORT_UNAVAILABLE", 404);
    }, true);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName==='contacts.csv'?'contacts.csv':'audit.csv'}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}
