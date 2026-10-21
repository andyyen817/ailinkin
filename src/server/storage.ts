import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { usePrivateFiles, putPrivateExport, readPrivateExport, deletePrivateExport } from './private-file-storage';
let client: S3Client | undefined;
function storage() {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw Error("STORAGE_NOT_CONFIGURED");
  client ??= new S3Client({ endpoint: S3_ENDPOINT, region: process.env.S3_REGION ?? "us-east-1", forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY }, maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  return { client, bucket: S3_BUCKET };
}
export async function putExport(key: string, body: Buffer) {
  if (usePrivateFiles()) return putPrivateExport(key, body);
  const { client, bucket } = storage();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "text/csv; charset=utf-8" }), { abortSignal: AbortSignal.timeout(15000) });
}
export async function readExport(key: string) {
  if (usePrivateFiles()) return readPrivateExport(key);
  const { client, bucket } = storage();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(15000) });
  if (!result.Body || (result.ContentLength ?? 0) > 1048576) throw Error("INVALID_EXPORT_SIZE");
  const bytes = await result.Body.transformToByteArray();
  if (bytes.length > 1048576) throw Error("INVALID_EXPORT_SIZE");
  return Buffer.from(bytes);
}
export async function deleteExpiredExport(key:string){
 if(!/^tenants\/[a-zA-Z0-9_-]+\/exports\/[a-f0-9-]{36}$/.test(key))throw Error('INVALID_CLEANUP_KEY');
 if(usePrivateFiles())return deletePrivateExport(key);
 const {client,bucket}=storage();await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)});
}
