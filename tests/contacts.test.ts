import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contactSchema,normalizeLinkedin} from '../src/domain/contacts';
import {parseContactCsv,mapContactCsv,exportContactsCsv,MAX_CSV_BYTES} from '../src/domain/contact-csv';
const bytes=(s:string)=>new TextEncoder().encode(s);
test('canonical LinkedIn identity rejects spoofed hosts and non-profile URLs',()=>{
 assert.equal(normalizeLinkedin('http://de.linkedin.com/in/Test/?trk=foo'),'https://www.linkedin.com/in/test');
 for(const value of ['https://linkedin.com.evil.test/in/a','https://linkedin.com/company/a','https://user@linkedin.com/in/a'])assert.throws(()=>normalizeLinkedin(value));
});
test('CSV supports BOM, quoted commas and multiline cells with explicit mappings',()=>{
 const table=parseContactCsv(bytes('\uFEFF姓名,公司,备注\r\nAlice,"Factory, Ltd","line 1\nline 2"'));
 const result=mapContactCsv(table,{name:'姓名',company:'公司',notes:'备注'});
 assert.equal(result[0].data?.company,'Factory, Ltd');assert.equal(result[0].data?.notes,'line 1\nline 2');
});
test('row errors preserve valid rows and cannot silently discard opt-out',()=>{
 const rows=mapContactCsv(parseContactCsv(bytes('n,c,e,d\nA,B,a@example.invalid,true\nC,D,bad,false\nE,F,e@example.invalid,maybe\nG,H')),{name:'n',company:'c',email:'e',doNotContact:'d'});
 assert.equal(rows[0].data?.doNotContact,true);assert.equal(rows[1].row,3);assert(rows[1].error);assert.equal(rows[2].error,'DO_NOT_CONTACT_INVALID');assert.equal(rows[3].error,'COLUMN_COUNT_MISMATCH');
});
test('CSV rejects oversized, non UTF8, duplicate headers, too many rows and ambiguous mappings',()=>{
 assert.throws(()=>parseContactCsv(new Uint8Array(MAX_CSV_BYTES+1)),/CSV_TOO_LARGE/);
 assert.throws(()=>parseContactCsv(new Uint8Array([255,254])),/CSV_UTF8/);
 assert.throws(()=>parseContactCsv(bytes('n,n\na,b')),/CSV_HEADERS/);
 assert.throws(()=>parseContactCsv(bytes('n,c\n'+'a,b\n'.repeat(10001))),/CSV_TOO_MANY_ROWS/);
 assert.throws(()=>mapContactCsv(parseContactCsv(bytes('n,c\na,b')),{name:'n',company:'n'}),/CSV_MAPPING/);
});
test('exports neutralize formulas even after whitespace and round trip ordinary data',()=>{
 for(const name of ['=1+1','  =1+1','\t@SUM(1)','-1','+1']){
  const contact=contactSchema.parse({name,company:'Factory'});
  assert(parseContactCsv(bytes(exportContactsCsv([contact]))).rows[0][0].startsWith("'"));
 }
 const contact=contactSchema.parse({name:'测试客户',company:'Factory, Ltd',email:'A@example.invalid',doNotContact:true,tags:['采购','采购']});
 const table=parseContactCsv(bytes(exportContactsCsv([contact])));
 const mapping=Object.fromEntries(table.headers.map(h=>[h,h]));
 assert.deepEqual(mapContactCsv(table,mapping)[0].data,contact);
});
