import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {AccessError} from './policy';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function exportPath(tenantId:string,id:string,version?:string){
  if(!/^[0-9a-f-]{36}$/.test(tenantId)||!/^[0-9a-f-]{36}$/.test(id)||
    version!==undefined&&!/^[a-f0-9]{64}$/.test(version))throw new AccessError('OPERATOR_EXPORT_DENIED',403);
  return path.resolve(process.env.OPERATOR_BATCH_EXPORT_DIR||'.runtime/operator-batch-exports',
    tenantId,id+(version?'.'+version:'')+'.xlsx');
}

export async function readOperatorExport(tenantId:string,id:string,metadata:any){
  if(!/^[a-f0-9]{64}$/.test(metadata?.sha256||'')||
    metadata.storageVersion!==undefined&&metadata.storageVersion!==2)throw new AccessError('OPERATOR_EXPORT_DENIED',403);
  const file=exportPath(tenantId,id,metadata.storageVersion===2?metadata.sha256:undefined);
  const bytes=await fs.readFile(file);
  if(sha(bytes)!==metadata.sha256)throw new AccessError('OPERATOR_EXPORT_CHANGED',409);
  return bytes;
}

export async function writeOperatorExport(tenantId:string,id:string,bytes:Uint8Array){
  const digest=sha(bytes),file=exportPath(tenantId,id,digest),temp=file+'.'+randomUUID()+'.tmp';
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(temp,bytes,{flag:'wx'});
  try{
    // Publish a complete immutable file. A failed DB commit leaves the old reference usable.
    try{await fs.link(temp,file);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    await readOperatorExport(tenantId,id,{storageVersion:2,sha256:digest});
  }finally{await fs.unlink(temp);}
  return {storageVersion:2,sha256:digest};
}
