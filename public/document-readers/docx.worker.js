
importScripts('./mammoth.browser.min.js');
self.onmessage=async({data})=>{
  try{const r=await mammoth.extractRawText({arrayBuffer:data});self.postMessage({text:r.value});}
  catch{self.postMessage({error:'Word资料无法读取，请检查文件或粘贴文字。'});}
};
