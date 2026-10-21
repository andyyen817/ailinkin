import { cp, mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
await import('./prepare-document-worker.mjs');
await import('./check-standalone-private.mjs');

const directory = resolve(".next/standalone");
await access(resolve(directory, "server.js"));
await mkdir(resolve(directory, ".next"), { recursive: true });
await cp(resolve(".next/static"), resolve(directory, ".next/static"), { recursive: true });
try { await access(resolve("public")); }
catch (error) { if (error.code !== "ENOENT") throw error; process.exit(0); }
await cp(resolve("public"), resolve(directory, "public"), { recursive: true });
