import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalDb = globalThis as unknown as { businessDb?: PrismaClient; identityDb?: PrismaClient };

function createClient(connectionString: string | undefined) {
  if (!connectionString) throw new Error("DATABASE_NOT_CONFIGURED");
  // Prisma's pg adapter normalizes database timestamps as UTC. Set this on
  // every connection, independently of the database/server machine timezone.
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 5000, max: 5, options: "-c timezone=UTC" });
  // Database errors may contain query values. Routes return sanitized errors.
  return new PrismaClient({ adapter, log: [] });
}

export function businessDb() { return globalDb.businessDb ??= createClient(process.env.DATABASE_URL); }
export function identityDb() { return globalDb.identityDb ??= createClient(process.env.AUTH_DATABASE_URL); }
