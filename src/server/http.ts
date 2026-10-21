import "server-only";
import { getAuth } from "./auth";
import { identityDb } from "./db";
import { AccessError, assertOrigin } from "./policy";
import { ZodError } from "zod";

export async function principalFor(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw new AccessError("AUTH_REQUIRED", 401);
  const user = await identityDb().user.findUnique({ where: { id: session.user.id } });
  if (!user || user.disabled) throw new AccessError("ACCOUNT_DISABLED", 403);
  return user;
}
export function mutationOrigin(request: Request) {
  assertOrigin(request.headers.get("origin"), process.env.BETTER_AUTH_URL ?? "http://invalid.local");
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function failure(error: unknown) {
  if (error instanceof AccessError) return json({ error: error.code }, error.status);
  if (error instanceof ZodError || error instanceof SyntaxError) return json({ error: "INVALID_INPUT" }, 400);
  return json({ error: "SERVICE_UNAVAILABLE" }, 503);
}
