import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retrieveExport} from '../src/domain/export-download';
const origin='https://example.test',path='/api/exports/fixed/download';
test('download preserves CSV bytes and authenticated request',async()=>{
 const csv='\uFEFFname,notes\r\nA,"line1\nline2"\r\n';
 const blob=await retrieveExport(path+'?signature=fixed',path,origin,async(url,options)=>{
  assert.equal(url,origin+path+'?signature=fixed');assert.equal(options?.credentials,'same-origin');
  assert.equal(options?.redirect,'error');return new Response(csv,{headers:{'content-type':'text/csv; charset=utf-8'}});
 });
 assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),new TextEncoder().encode(csv));
});
test('download rejects denied, non-CSV, empty, oversized and foreign responses',async()=>{
 for(const response of [new Response('{}',{status:403}),new Response('login',{headers:{'content-type':'text/html'}}),new Response('',{headers:{'content-type':'text/csv'}}),new Response(new Uint8Array(1048577),{headers:{'content-type':'text/csv'}})])
  await assert.rejects(retrieveExport(path,path,origin,async()=>response));
 await assert.rejects(retrieveExport('https://other.test'+path,path,origin,async()=>{throw Error('MUST_NOT_FETCH');}),/INVALID_DOWNLOAD_URL/);
});
