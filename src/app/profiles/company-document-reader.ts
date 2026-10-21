const MAX_BYTES=8*1024*1024,MAX_TEXT=20000;
export function checkedDocumentText(name:string,text:string){
  const value=text.replace(/\u0000/g,'').trim();
  if(!value)throw Error('未取得可读取文字；扫描版或图片资料需要先转成文字。');
  if(value.length>MAX_TEXT)throw Error('资料文字超过20000字，请拆分或提供重点内容；没有截断后冒充完整读取。');
  return {name,text:value};
}
export function checkDocxArchive(buffer:ArrayBuffer){
  const v=new DataView(buffer);let total=0,entries=0;
  for(let i=0;i+46<=v.byteLength;i++)if(v.getUint32(i,true)===0x02014b50){
    const size=v.getUint32(i+24,true),name=v.getUint16(i+28,true),extra=v.getUint16(i+30,true),comment=v.getUint16(i+32,true);
    if(size===0xffffffff||i+46+name+extra+comment>v.byteLength)throw Error('Word资料结构或解压范围不支持。');
    total+=size;entries++;i+=45+name+extra+comment;
  }
  if(!entries||entries>3000||total>24*1024*1024)throw Error('Word资料解压内容过大或格式不正确。');
}
async function docxText(buffer:ArrayBuffer){
  checkDocxArchive(buffer);
  const worker=new Worker('/document-readers/docx.worker.js');
  try{return await new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Word读取超时，请提供较小文件或粘贴文字。')),20000);
    worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(Error(data.error)):resolve(data.text);};
    worker.onerror=()=>{clearTimeout(timer);reject(Error('Word文字读取失败。'));};worker.postMessage(buffer,[buffer]);
  });}finally{worker.terminate();}
}
export async function readCompanyDocument(file:File){
  if(file.size>MAX_BYTES)throw Error('单份资料最多8MB，请压缩或提供重点内容。');
  const suffix=file.name.split('.').at(-1)?.toLowerCase();
  if(!['txt','md','pdf','docx'].includes(suffix||''))throw Error('支持TXT、Markdown、PDF、Word DOCX；旧版DOC请另存为DOCX。');
  if(suffix==='txt'||suffix==='md')return checkedDocumentText(file.name,await file.text());
  const buffer=await file.arrayBuffer();
  if(suffix==='docx')return checkedDocumentText(file.name,await docxText(buffer));
  const pdf=await import('pdfjs-dist');pdf.GlobalWorkerOptions.workerSrc='/document-readers/pdf.worker.min.mjs';
  const task=pdf.getDocument({data:new Uint8Array(buffer),enableXfa:false,disableFontFace:true,maxImageSize:0});
  const timer=setTimeout(()=>void task.destroy(),20000);
  try{const doc=await task.promise;if(doc.numPages>50)throw Error('PDF最多50页，请拆分或提供重点页面。');
    const pages:string[]=[];for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),content=await page.getTextContent();
      pages.push(content.items.map(item=>'str' in item?item.str+('hasEOL' in item&&item.hasEOL?'\n':' '):'').join(''));
      if(pages.join('\n').length>MAX_TEXT)throw Error('PDF文字超过20000字，请拆分。');page.cleanup();}
    return checkedDocumentText(file.name,pages.join('\n'));
  }catch(e){if((e as any).name==='PasswordException')throw Error('PDF需要密码，请先提供可读取的副本。');throw e;}
  finally{clearTimeout(timer);await task.destroy();}
}
