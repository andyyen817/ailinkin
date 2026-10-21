import {copyFile,mkdir,writeFile} from 'node:fs/promises';
await mkdir('public/document-readers',{recursive:true});
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','public/document-readers/pdf.worker.min.mjs');
await copyFile('node_modules/mammoth/mammoth.browser.min.js','public/document-readers/mammoth.browser.min.js');
await writeFile('public/document-readers/docx.worker.js',`
importScripts('./mammoth.browser.min.js');
self.onmessage=async({data})=>{
  try{const r=await mammoth.extractRawText({arrayBuffer:data});self.postMessage({text:r.value});}
  catch{self.postMessage({error:'Word资料无法读取，请检查文件或粘贴文字。'});}
};
`);
