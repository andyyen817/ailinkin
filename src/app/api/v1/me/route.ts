import { identityDb } from "@/server/db";
import { principalFor, json, failure } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await principalFor(request);
    const memberships = await identityDb().$queryRaw<Array<{ tenant_id: string; name: string; role: string; status: string }>>`SELECT * FROM public.my_memberships(${user.id})`;
    return json({ user: { name: user.name, twoFactorEnabled: user.twoFactorEnabled, platformRole: user.platformRole }, memberships });
  } catch (error) { return failure(error); }
}
