import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { createHash } from "node:crypto";
import { putExport,deleteExpiredExport } from "../server/storage";
import {exportContactsCsv} from '../domain/contact-csv';
import {contactSchema,type ContactData} from '../domain/contacts';
const queueName = "tenant-exports-v1";
type Claim = { id: string; tenant_id: string; actor_id: string; kind: string; lease_token: string };
export async function startExportWorker() {
  if (!process.env.REDIS_URL || !process.env.WORKER_DATABASE_URL) throw Error("WORKER_NOT_CONFIGURED");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.WORKER_DATABASE_URL, options: "-c timezone=UTC", max: 4 }), log: [] });
  const roles = await db.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
  if (roles.length !== 1 || roles[0].rolsuper || roles[0].rolbypassrls) { await db.$disconnect(); throw Error("UNSAFE_WORKER_ROLE"); }
  const workerConnection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, retryStrategy: times => Math.min(times * 500, 5000) });
  const producerConnection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  workerConnection.on("error", () => {}); producerConnection.on("error", () => {});
  const queue = new Queue(queueName, { connection: producerConnection });
  const worker = new Worker<{ id: string }>(queueName, async message => {
    if (typeof message.data.id !== "string" || !/^[a-f0-9-]{36}$/.test(message.data.id)) return;
    const claims = await db.$queryRaw<Claim[]>`SELECT * FROM public.claim_job(${message.data.id})`;
    const claim = claims[0]; if (!claim) return;
    try {
      let csv:string;
      if(claim.kind==='contact_export'){
       const rows=await db.$queryRaw<Array<{data:ContactData}>>`SELECT * FROM public.export_contact_rows(${claim.id},${claim.lease_token})`;
       csv=exportContactsCsv(rows.map(row=>contactSchema.parse(row.data)));
      }else if(claim.kind==='audit_export'){
      const rows = await db.$queryRaw<Array<{ action: string; created_at: Date }>>`SELECT * FROM public.export_audit_rows(${claim.id},${claim.lease_token})`;
      const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
      csv = "\uFEFFaction,created_at\r\n" + rows.map(row => `${cell(row.action)},${cell(row.created_at.toISOString())}`).join("\r\n") + "\r\n";
      }else throw Error('UNSUPPORTED_JOB');
      const body = Buffer.from(csv), digest = createHash("sha256").update(body).digest("hex");
      if (body.length > 1048576) throw Error("EXPORT_TOO_LARGE");
      await putExport(`tenants/${claim.tenant_id}/exports/${claim.id}`, body);
      await db.$queryRaw`SELECT public.complete_export(${claim.id},${claim.lease_token},${body.length}::integer,${digest})`;
    } catch {
      await db.$executeRaw`SELECT public.fail_job(${claim.id},${claim.lease_token})`;
    }
  }, { connection: workerConnection, concurrency: 2 });
  worker.on("error", () => {});
  let closing = false, dispatching: Promise<void> | null = null;
  let cleanupAt=0;
  async function dispatch() {
    if (closing || dispatching) return;
    dispatching = (async () => {
      if(Date.now()>=cleanupAt){
       cleanupAt=Date.now()+60000;
       const expired=await db.$queryRaw<Array<{id:string;object_key:string}>>`SELECT * FROM public.expired_export_objects()`;
       for(const file of expired){await deleteExpiredExport(file.object_key);await db.$executeRaw`SELECT public.finish_export_cleanup(${file.id})`;}
       await db.$executeRaw`SELECT public.clean_expired_import_payloads()`;
      }
      const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT * FROM public.pending_jobs()`;
      for (const row of rows) await queue.add("run-persisted", { id: row.id }, { jobId: row.id, attempts: 1, removeOnComplete: true, removeOnFail: true });
    })();
    try { await dispatching; } catch { /* durable outbox remains in PostgreSQL */ } finally { dispatching = null; }
  }
  await worker.waitUntilReady(); await queue.waitUntilReady(); await dispatch();
  const timer = setInterval(() => { void dispatch(); }, 1000);
  return { queue, dispatch, async close() { closing = true; clearInterval(timer); await dispatching?.catch(() => {}); await worker.close(); await queue.close(); await Promise.all([workerConnection.quit(), producerConnection.quit()]); await db.$disconnect(); } };
}
