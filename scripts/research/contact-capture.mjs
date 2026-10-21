import {createHash} from 'node:crypto';
/** @param {import('playwright').Page} page @param {{maxImages?:number,sourceUrl?:string,retrievedAt?:string}} options */
export async function captureContactRegions(page,{maxImages=2,sourceUrl,retrievedAt=new Date().toISOString()}={}){
  if(!Number.isInteger(maxImages)||maxImages<0||maxImages>4)throw Error('INVALID_CAPTURE_LIMIT');
  if(!maxImages)return [];
  const viewport=page.viewportSize();if(!viewport||viewport.width>1600||viewport.height>1200)throw Error('INVALID_CAPTURE_VIEWPORT');
  const region=page.locator('main, [role="main"]').first();let box=await region.boundingBox().catch(()=>null);
  box ||= await page.locator('body').boundingBox();if(!box||box.width<40||box.height<20)throw Error('EMPTY_CAPTURE_REGION');
  const images=[];
  for(let n=0;n<maxImages&&n*viewport.height<box.height;n++){
    const y=box.y+n*viewport.height;await page.evaluate(y=>window.scrollTo(0,y),y);
    const bytes=await page.screenshot({type:'png',fullPage:false,animations:'disabled'});
    if(bytes.length>2097152)throw Error('CAPTURE_IMAGE_TOO_LARGE');
    const contentHash=createHash('sha256').update(bytes).digest('hex');
    images.push({id:'IMG-'+contentHash.slice(0,24),imageId:contentHash,sourceUrl,retrievedAt,contentHash,mime:'image/png',bytes,
      region:{x:0,y,width:viewport.width,height:viewport.height},coverage:'visible_segment',needsVisualReview:true});
  }
  return images;
}
