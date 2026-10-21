import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { withTenant } from "@/server/tenant";
import { mutationOrigin, json, failure } from "@/server/http";
export async function POST(request: Request, route: { params: Promise<{ tenantId: string }> }) {
  try {
    mutationOrigin(request);
    const { email } = z.object({ email: z.string().email().max(254) }).parse(await request.json());
    const { tenantId } = await route.params;
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    await withTenant(request, tenantId, async tx => {
      await tx.$queryRaw`SELECT public.issue_invitation(${email.toLowerCase()}, ${hash})`;
    }, true);
    return json({ invitationUrl: `${process.env.BETTER_AUTH_URL}/invite#${token}`, expiresInHours: 48 }, 201);
  } catch (error) { return failure(error); }
}
