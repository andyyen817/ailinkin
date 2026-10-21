import 'server-only';
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from 'zod';
const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
const root=path.resolve('.runtime/contact-evidence');
async function directory(tenantId:string){
  z.uuid().parse(tenantId);
  await fs.mkdir(root,{recursive:true});await fs.mkdir(path.join(root,tenantId),{recursive:true});
  for(const p of [root,path.join(root,tenantId)])if((await fs.lstat(p)).isSymbolicLink())throw Error('EVIDENCE_SYMLINK_REJECTED');
  return path.join(root,tenantId);
}
export async function putContactImage(tenantId:string,bytes:Buffer){
  if(bytes.length<24||bytes.length>2097152||!bytes.subarray(0,8).equals(pngSignature))throw Error('INVALID_CONTACT_PNG');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>1600||height>1200)throw Error('INVALID_CONTACT_IMAGE_DIMENSIONS');
  const contentHash=createHash('sha256').update(bytes).digest('hex'),dir=await directory(tenantId),target=path.join(dir,contentHash+'.png');
  try{await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    if(!createHash('sha256').update(await fs.readFile(target)).digest('hex').includes(contentHash))throw Error('CONTACT_IMAGE_CONFLICT');}
  return {imageId:contentHash,contentHash,mime:'image/png',size:bytes.length,width,height,storage:'tenant_local_private'};
}
export async function readContactImage(tenantId:string,imageId:string){
  z.string().regex(/^[a-f0-9]{64}$/).parse(imageId);const file=path.join(await directory(tenantId),imageId+'.png');
  const stat=await fs.lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>2097152)throw Error('INVALID_CONTACT_IMAGE_FILE');
  const bytes=await fs.readFile(file);if(createHash('sha256').update(bytes).digest('hex')!==imageId)throw Error('CONTACT_IMAGE_HASH_CHANGED');
  return bytes;
}
