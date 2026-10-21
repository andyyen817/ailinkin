import 'server-only';
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {publicGet} from '../../scripts/research/public-page-client.mjs';
import {robotsPolicy} from '../../scripts/research/public-page-policy.mjs';
import {htmlContactText,accessBarrier} from '../../scripts/research/contact-text-extractor.mjs';
export async function tracePdfText(bytes:Uint8Array,url:string,maxPages:number){
  if(bytes.length>5242880||Buffer.from(bytes).subarray(0,5).toString()!=='%PDF-'||!Number.isInteger(maxPages)||maxPages<1||maxPages>10)throw Error('TRACE_PDF_BOUND_DENIED');
  const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdf.GlobalWorkerOptions.workerSrc=pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  const task=pdf.getDocument({data:new Uint8Array(bytes),verbosity:0,enableXfa:false,disableFontFace:true,useWorkerFetch:false,maxImageSize:0,stopAtErrors:true});
  const timer=setTimeout(()=>void task.destroy(),20000);
  try{const doc=await task.promise,pages:any[]=[],links:any[]=[];let characters=0;
    for(let number=1;number<=Math.min(doc.numPages,maxPages);number++){
      const page=await doc.getPage(number),content=await page.getTextContent();
      const text=content.items.map((i:any)=>'str' in i?i.str+(i.hasEOL?'\n':' '):'').join('').trim();characters+=text.length;if(characters>120000)throw Error('TRACE_PDF_TEXT_CAP');
      pages.push({number,text,sourceUrl:url+'#page='+number});
      for(const annotation of await page.getAnnotations())if(annotation.url)links.push({url:annotation.url,label:'',pageNumber:number});page.cleanup();
    }
    if(!pages.some(p=>p.text))throw Error('TRACE_PDF_NO_TEXT_OR_SCAN');
    return {pages,links,totalPages:doc.numPages,pagesRead:pages.length,complete:pages.length===doc.numPages,personText:pages.map(p=>p.text).join('\n\n')};
  }finally{clearTimeout(timer);await task.destroy();}
}
export async function readTracePage(op:any,batch:any,record:any,get:any=publicGet){
  const before=async({url}:{url:string})=>{const used=batch.receipts.flatMap((r:any)=>r.stages||[]).filter((s:any)=>s.stage==='public_network_started').length;
    if(used>=batch.limits.network)throw Error('PUBLIC_NETWORK_CAP_REACHED');await record({stage:'public_network_started',url,at:new Date().toISOString()});};
  const fetch=async(url:string,limit:number,binary=false)=>{
    const raw=await get(url,{beforeRequest:before,maxRequests:1,followRedirects:false,timeoutMs:10000,limit,binary,acceptResponse:(headers:any,status:number)=>{
      if(Number(headers['content-length'])>limit)throw Error('TRACE_RESPONSE_BYTES_CAP');
      if(binary&&status===200&&(/application\/pdf/i.test(headers['content-type']||'')||/\.pdf(?:[?#]|$)/i.test(url))){
        if(batch.receipts.flatMap((r:any)=>r.stages||[]).filter((s:any)=>s.stage==='public_pdf_saved').length>=batch.limits.pdfs)throw Error('TRACE_PDF_COUNT_CAP');
      }
    }});
    await record({stage:'public_body_received',url,httpStatus:raw.status,rawResponse:binary&&/application\/pdf/i.test(raw.headers?.['content-type']||'')?'PDF二进制；原文另存并记录哈希':String(raw.text||'').slice(0,96000)});return raw;
  };
  let url=op.url;
  try{for(let redirects=0;redirects<3;redirects++){
    const origin=new URL(url).origin,robotsUrl=origin+'/robots.txt';
    if(batch.traceHeldOrigins?.[origin])throw Error('TRACE_ORIGIN_HELD: '+batch.traceHeldOrigins[origin]);
    let robots=batch.receipts.flatMap((r:any)=>r.stages||[]).findLast((s:any)=>s.stage==='public_body_received'&&s.url===robotsUrl);
    if(!robots){
      if(batch.receipts.flatMap((r:any)=>r.stages||[]).some((s:any)=>s.stage==='public_network_started'&&s.url===robotsUrl))throw Error('TRACE_ROBOTS_UNKNOWN_NO_RETRY');
      const raw=await fetch(robotsUrl,512000);robots={httpStatus:raw.status,rawResponse:raw.text};
    }else await record({stage:'public_robots_reused',url:robotsUrl});
    if(![200,404,410].includes(robots.httpStatus))throw Error('TRACE_ROBOTS_UNAVAILABLE');
    const policy=robotsPolicy(robots.httpStatus===200?robots.rawResponse:'',url);if(!policy.allowed||policy.delay>10)throw Error('TRACE_ROBOTS_RESTRICTED');
    if(policy.delay>1)await new Promise(resolve=>setTimeout(resolve,policy.delay*1000));
    if(/\.pdf(?:[?#]|$)/i.test(url)&&batch.receipts.flatMap((r:any)=>r.stages||[]).filter((s:any)=>s.stage==='public_pdf_saved').length>=batch.limits.pdfs)throw Error('TRACE_PDF_COUNT_CAP');
    const raw=await fetch(url,batch.limits.pdfBytes,true),type=raw.headers?.['content-type']||'';
    if([301,302,303,307,308].includes(raw.status)&&raw.headers?.location){url=new URL(raw.headers.location,url).href;continue;}
    if(raw.status!==200)throw Error('TRACE_PUBLIC_HTTP_'+raw.status);
    const bytes=raw.bytes||Buffer.from(raw.text||'');
    if(/application\/pdf/i.test(type)||Buffer.from(bytes).subarray(0,5).toString()==='%PDF-'){
      if(batch.receipts.flatMap((r:any)=>r.stages||[]).filter((s:any)=>s.stage==='public_pdf_saved').length>=batch.limits.pdfs)throw Error('TRACE_PDF_COUNT_CAP');
      const sha256=createHash('sha256').update(bytes).digest('hex');
      if(!/^[a-f0-9-]{36}$/i.test(batch.id))throw Error('TRACE_BATCH_PATH_DENIED');
      const root=path.resolve(process.env.OPERATOR_BATCH_EXPORT_DIR||'.runtime/operator-batch-20261018/exports'),directory=path.resolve(root,'trace-pdfs',batch.id);
      if(!directory.startsWith(root+path.sep))throw Error('TRACE_PDF_PATH_DENIED');await fs.mkdir(directory,{recursive:true});
      const filePath=path.join(directory,sha256+'.pdf');await fs.writeFile(filePath,bytes,{flag:'wx'}).catch((e:any)=>{if(e.code!=='EEXIST')throw e;});
      await record({stage:'public_pdf_saved',url,sha256,filePath,bytes:bytes.length});
      const parsed=await tracePdfText(bytes,url,batch.limits.pdfPages);
      return {state:'read',format:'pdf',url,...parsed,heading:'',readAt:new Date().toISOString(),rawArtifact:{sha256,filePath,bytes:bytes.length}};
    }
    if(!/text\/(?:html|plain)/i.test(type)||accessBarrier(raw.text,raw.status))throw Error('TRACE_PUBLIC_LOGIN_OR_CONTENT_RESTRICTED');
    const html=raw.text.replace(/<(footer|nav|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' '),parsed=htmlContactText(html,url);
    const heading=htmlContactText((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||'',url).text;
    return {state:'read',format:'html',url,heading,personText:parsed.text.slice(0,64000),links:parsed.links,readAt:new Date().toISOString()};
  }throw Error('TRACE_REDIRECT_CAP');
  }catch(e){return {state:'restricted',url,links:[],reason:(e as Error).message.slice(0,250),readAt:new Date().toISOString()};}
}
