import { readdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve('.next/standalone');
await access(resolve(root,'server.js'));
const entries=await readdir(root);
const prohibited=entries.filter(name=>['.runtime','evidence','output','outputs','工作交流'].includes(name)||name.startsWith('.env'));
if(prohibited.length)throw Error('STANDALONE_PRIVATE_ARTIFACTS: '+prohibited.join(', '));
