export async function retrieveExport(url: string, expectedPath: string, origin: string,
  request: typeof fetch = fetch): Promise<Blob> {
  const target = new URL(url, origin);
  if (target.origin !== origin || target.pathname !== expectedPath) throw Error('INVALID_DOWNLOAD_URL');
  const response = await request(target.href, {credentials:'same-origin',cache:'no-store',redirect:'error'});
  if (!response.ok) throw Error('DOWNLOAD_HTTP_' + response.status);
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/csv')) throw Error('INVALID_DOWNLOAD_TYPE');
  const blob = await response.blob();
  if (blob.size === 0 || blob.size > 1048576) throw Error('INVALID_DOWNLOAD_SIZE');
  return blob;
}
