import { access, unlink } from "node:fs/promises";
import { requireRuntime } from './runtime-guard.mjs';
requireRuntime('worker');
const { startExportWorker } = await import('../src/worker/export-worker');
const { startContactImportWorker } = await import('../src/worker/contact-import-worker');
const runtime = await startExportWorker();
const imports = await startContactImportWorker();
console.log("EXPORT_WORKER_READY");
let closing = false;
const timer = setInterval(async () => {
  if (await access(".runtime/worker.stop").then(() => true, () => false)) await close();
}, 1000);
async function close() { if (closing) return; closing = true; clearInterval(timer); await Promise.all([runtime.close(),imports.close()]); await unlink(".runtime/worker.stop").catch(() => {}); process.exit(0); }
process.on("SIGTERM", close); process.on("SIGINT", close);
