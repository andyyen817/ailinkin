import { z } from "zod";
import { withTenant } from "@/server/tenant";
import { mutationOrigin, json, failure } from "@/server/http";
export async function GET(request: Request, route: { params: Promise<{ tenantId: string }> }) {
  try { const { tenantId } = await route.params; return json({ members: await withTenant(request, tenantId, tx => tx.$queryRaw`SELECT * FROM public.tenant_members()`, true) }); }
  catch (error) { return failure(error); }
}
export async function PATCH(request: Request, route: { params: Promise<{ tenantId: string }> }) {
  try {
    mutationOrigin(request); const { tenantId } = await route.params;
    const { membershipId } = z.object({ membershipId: z.string().uuid(), action: z.literal("disable") }).parse(await request.json());
    await withTenant(request, tenantId, tx => tx.$executeRaw`SELECT public.disable_member(${membershipId})`, true);
    return json({ disabled: true });
  } catch (error) { return failure(error); }
}
