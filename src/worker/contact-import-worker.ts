import {Queue,Worker} from 'bullmq';
import {Redis} from 'ioredis';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../generated/prisma/client';
export async function startContactImportWorker(){
 if(!process.env.REDIS_URL||!process.env.WORKER_DATABASE_URL)throw Error('WORKER_NOT_CONFIGURED');
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.WORKER_DATABASE_URL,options:'-c timezone=UTC',max:2}),log:[]});
 const connection=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:null});connection.on('error',()=>{});
 const producer=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:1,enableOfflineQueue:false});producer.on('error',()=>{});
 const queue=new Queue('contact-imports-v1',{connection:producer});
 const worker=new Worker<{id:string}>('contact-imports-v1',async job=>{
  if(typeof job.data.id!=='string'||!/^[a-f0-9-]{36}$/.test(job.data.id))return;
  await db.$executeRaw`SELECT public.run_contact_import(${job.data.id})`;
 },{connection,concurrency:1});worker.on('error',()=>{});
 let closing=false,running:Promise<void>|null=null;
 async function dispatch(){if(closing||running)return;running=(async()=>{const rows=await db.$queryRaw<Array<{id:string}>>`SELECT * FROM public.pending_contact_imports()`;for(const row of rows)await queue.add('persisted',{id:row.id},{jobId:row.id,removeOnComplete:true,removeOnFail:true,attempts:1});})();try{await running;}catch{/* PostgreSQL retains pending work. */}finally{running=null;}}
 await worker.waitUntilReady();await queue.waitUntilReady();await dispatch();const timer=setInterval(()=>void dispatch(),1000);
 return {async close(){closing=true;clearInterval(timer);await running;await worker.close();await queue.close();await Promise.all([connection.quit(),producer.quit()]);await db.$disconnect();}};
}
