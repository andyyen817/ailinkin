import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'csv-parse/sync';
import {contactSchema,stages} from '../src/domain/contacts';
import {exportContactsCsv,mapContactCsv,parseContactCsv} from '../src/domain/contact-csv';

test('CSV multiline notes stay in one record for common CSV readers',()=>{
 const rows=stages.flatMap(stage=>['first\nsecond','first\rsecond','first\r\nsecond','"quotes", commas','中文\n换行'].map(notes=>contactSchema.parse({name:'Regression',company:'Factory',notes,stage,doNotContact:true,notInterested:true})));
 const csv=exportContactsCsv(rows);
 const cells=parse<Record<string,string>>(csv,{bom:true,columns:true,record_delimiter:['\r\n','\n','\r']});
 assert.equal(cells.length,rows.length);
 for(let i=0;i<rows.length;i++){
  assert.equal(cells[i].notes,rows[i].notes);assert.equal(cells[i].stage,rows[i].stage);
  assert.equal(cells[i].doNotContact,'true');assert.equal(cells[i].notInterested,'true');
 }
 const table=parseContactCsv(new TextEncoder().encode(csv));
 assert.deepEqual(mapContactCsv(table,Object.fromEntries(table.headers.map(h=>[h,h]))).map(x=>x.data),rows);
});

test('legacy CSV defaults remain compatible and invalid follow-up values fail per row',()=>{
 const rows=mapContactCsv({headers:['n','c','s','i'],rows:[['A','B','bad','false'],['C','D','已入选','maybe'],['E','F','','是']]},{name:'n',company:'c',stage:'s',notInterested:'i'});
 assert.ok(rows[0].error?.startsWith('stage:'));assert.equal(rows[1].error,'NOT_INTERESTED_INVALID');
 assert.equal(rows[2].data?.stage,'待筛选');assert.equal(rows[2].data?.notInterested,true);
});
