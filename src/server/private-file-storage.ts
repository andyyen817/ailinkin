import { constants } from 'node:fs';
import { mkdir, lstat, open, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const limit = 1048576;
const keyPattern = /^tenants\/[a-zA-Z0-9_-]{1,128}\/exports\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function usePrivateFiles() {
  const driver = process.env.STORAGE_DRIVER ?? 's3';
  if (!['s3', 'filesystem'].includes(driver)) throw Error('INVALID_STORAGE_DRIVER');
  return driver === 'filesystem';
}
async function target(key: string, create = false) {
  if (!keyPattern.test(key)) throw Error('INVALID_STORAGE_KEY');
  const root = process.env.PRIVATE_STORAGE_DIR;
  if (!root || !path.isAbsolute(root)) throw Error('PRIVATE_STORAGE_NOT_CONFIGURED');
  let current = path.resolve(root);
  if (create) await mkdir(current, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(current);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw Error('UNSAFE_STORAGE_DIRECTORY');
  const parts = key.split('/');
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (create) await mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('UNSAFE_STORAGE_DIRECTORY');
  }
  return path.join(current, parts.at(-1)!);
}
async function readFile(file: string) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw Error('INVALID_EXPORT_FILE');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.size > limit) throw Error('INVALID_EXPORT_FILE');
    const body = await handle.readFile();
    if (body.length > limit) throw Error('INVALID_EXPORT_SIZE');
    return body;
  } finally { await handle.close(); }
}
export async function readPrivateExport(key: string) { return readFile(await target(key)); }
export async function putPrivateExport(key: string, body: Buffer) {
  if (body.length > limit) throw Error('INVALID_EXPORT_SIZE');
  const file = await target(key, true), temporary = file + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
    try { await link(temporary, file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await readFile(file)).equals(body)) throw Error('EXPORT_CONTENT_CONFLICT');
    }
  } finally { await unlink(temporary); }
}
export async function deletePrivateExport(key: string) {
  try {
    const file = await target(key), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('INVALID_EXPORT_FILE');
    await unlink(file);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
