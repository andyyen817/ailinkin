import { createHmac, timingSafeEqual } from "node:crypto";
import { AccessError } from "./policy";
function key() { const value = process.env.DOWNLOAD_SIGNING_SECRET; if (!value || value.length < 32) throw Error("DOWNLOAD_NOT_CONFIGURED"); return value; }
export function signDownload(tenantId: string, userId: string, fileId: string, expires = Math.floor(Date.now() / 1000) + 60) {
  const message = JSON.stringify([tenantId, userId, fileId, expires]);
  return { expires, signature: createHmac("sha256", key()).update(message).digest("hex") };
}
export function verifyDownload(tenantId: string, userId: string, fileId: string, expires: number, signature: string) {
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(expires) || expires < now || expires > now + 60 || !/^[a-f0-9]{64}$/.test(signature)) throw new AccessError("DOWNLOAD_EXPIRED_OR_INVALID", 403);
  const expected = signDownload(tenantId, userId, fileId, expires).signature;
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"))) throw new AccessError("DOWNLOAD_EXPIRED_OR_INVALID", 403);
}
