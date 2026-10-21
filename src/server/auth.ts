import "server-only";
import { betterAuth } from "better-auth/minimal";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { identityDb } from "./db";
import { configurationPresent } from "./policy";
import { sendPasswordReset } from "./mail";

function createAuth() {
  if (!configurationPresent(process.env)) throw new Error("AUTH_NOT_CONFIGURED");
  return betterAuth({
    appName: "AI 领英搜索助手",
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(identityDb(), { provider: "postgresql" }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 6,
      resetPasswordTokenExpiresIn: 1800, revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => { await sendPasswordReset(user.email, url); },
    },
    session: { expiresIn: 60 * 60 * 24, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    user: { additionalFields: {
      platformRole: { type: "string", defaultValue: "user", input: false },
      disabled: { type: "boolean", defaultValue: false, input: false },
    } },
    databaseHooks: { session: { create: { before: async session => {
      const user = await identityDb().user.findUnique({ where: { id: session.userId } });
      if (!user || user.disabled) return false;
      return { data: session };
    } } } },
    plugins: [twoFactor({ issuer: "AI 领英搜索助手" })],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() { return instance ??= createAuth(); }
