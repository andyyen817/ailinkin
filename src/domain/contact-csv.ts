import {parse} from 'csv-parse/sync';
import {stringify} from 'csv-stringify/sync';
import {contactSchema,type ContactData} from './contacts';
export const csvFields=['name','company','title','country','email','linkedin','tags','notes','doNotContact','stage','notInterested'] as const;
export type CsvField=typeof csvFields[number];
export const MAX_CSV_BYTES=10*1024*1024,MAX_CSV_ROWS=10000;
export type CsvTable={headers:string[];rows:string[][]};
export function parseContactCsv(bytes:Uint8Array):CsvTable{
 if(bytes.byteLength>MAX_CSV_BYTES)throw Error('CSV_TOO_LARGE');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('CSV_UTF8_REQUIRED');}
 if(text.includes('\0'))throw Error('CSV_NUL_FORBIDDEN');
 const records=parse(text,{bom:true,skip_empty_lines:true,relax_column_count:true,max_record_size:65536}) as string[][];
 if(records.length<2)throw Error('CSV_DATA_REQUIRED');
 if(records.length>MAX_CSV_ROWS+1)throw Error('CSV_TOO_MANY_ROWS');
 const headers=records[0].map(v=>v.trim());
 if(headers.length>50||headers.some(v=>!v||v.length>300)||new Set(headers).size!==headers.length)throw Error('CSV_HEADERS_INVALID');
 return {headers,rows:records.slice(1)};
}
export function mapContactCsv(table:CsvTable,mapping:Partial<Record<CsvField,string>>){
 for(const key of Object.keys(mapping))if(!csvFields.includes(key as CsvField))throw Error('CSV_MAPPING_INVALID');
 const selected=Object.values(mapping).filter(Boolean);
 if(!mapping.name||!mapping.company||selected.some(v=>!table.headers.includes(v!))||new Set(selected).size!==selected.length)throw Error('CSV_MAPPING_INVALID');
 return table.rows.map((cells,index):{row:number;data?:ContactData;error?:string}=>{
  const row=index+2;
  if(cells.length!==table.headers.length)return {row,error:'COLUMN_COUNT_MISMATCH'};
  const raw:Record<string,unknown>={};
  for(const field of csvFields){const header=mapping[field];if(header)raw[field]=cells[table.headers.indexOf(header)].trim();}
  if(typeof raw.tags==='string')raw.tags=raw.tags.split(';').map(v=>v.trim()).filter(Boolean);
  for(const field of ['doNotContact','notInterested'] as const)if(typeof raw[field]==='string'){
   const value=raw[field].toLowerCase();
   if(!['','false','0','no','否','true','1','yes','是'].includes(value))return {row,error:field==='doNotContact'?'DO_NOT_CONTACT_INVALID':'NOT_INTERESTED_INVALID'};
   raw[field]=['true','1','yes','是'].includes(value);
  }
  if(raw.stage==='')delete raw.stage;
  const parsed=contactSchema.safeParse(raw);
  return parsed.success?{row,data:parsed.data}:{row,error:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')};
 });
}
export function exportContactsCsv(contacts:ContactData[]){
 // Excel may ignore leading whitespace before a formula. Escape before serialization.
 const safe=(value:string)=>/^[\s\uFEFF]*[=+@-]/u.test(value)||/^[\t\r\n]/.test(value)?`'${value}`:value;
 return stringify(contacts.map(c=>csvFields.map(f=>safe(f==='tags'?c.tags.join(';'):String(c[f])))),{header:true,columns:[...csvFields],bom:true,quoted:true,record_delimiter:'\r\n'});
}
