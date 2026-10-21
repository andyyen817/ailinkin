import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Generation/validation work without secrets. Database operations require an explicit URL.
  datasource: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "" },
});
