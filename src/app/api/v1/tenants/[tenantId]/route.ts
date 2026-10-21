import { withTenant } from "@/server/tenant";
import { json, failure } from "@/server/http";

export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  try {
    const tenant = await withTenant(request, tenantId, (tx, context) => tx.tenant.findUnique({
      where: { id: context.tenantId }, select: { id: true, name: true, status: true, monthlyEnrichmentQuota: true },
    }));
    return json({ data: tenant });
  } catch (error) {
    return failure(error);
  }
}
