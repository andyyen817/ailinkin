import {browserPlatformUrl} from './browser-contact-policy.mjs';
import {browserState} from './browser-contact-session.mjs';
import {contactText} from './contact-text-extractor.mjs';
import {hash} from './core.mjs';
import {publishedContactLinks} from './public-contact-links.mjs';
const norm=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function relatedBrowserText(text,company,personName=''){
  return [company.name,...(company.verifiedAliases||[])].some(v=>norm(v)&&norm(text).includes(norm(v)))||!!personName&&norm(text).includes(norm(personName));
}
function publicPageUrl(raw){const u=new URL(raw);for(const k of [...u.searchParams.keys()])if(!['q','query','keyword','id','fbid','story_fbid'].includes(k))u.searchParams.delete(k);u.hash='';return u.href;}
async function visibleSearch(page){
  const candidates=[page.getByRole('searchbox'),page.getByRole('combobox',{name:/search|cari|搜尋|搜索/i}),page.locator('input[placeholder]')];
  for(const group of candidates)for(let i=0;i<Math.min(await group.count(),15);i++){
    const input=group.nth(i),label=[await input.getAttribute('placeholder'),await input.getAttribute('aria-label')].join(' ');
    if(await input.isVisible()&&await input.isEditable()&&(group!==candidates[2]||/search|cari|搜尋|搜索/i.test(label)))return input;
  }
  return null;
}
async function visibleDocument(page){
  return page.evaluate(()=>{const main=document.querySelector('main,[role="main"]')||document.body;
    return {text:main.innerText||'',url:location.href,links:[...main.querySelectorAll('a[href]')].filter(a=>a.getClientRects().length)
      .map(a=>({url:a.href,label:a.innerText||a.textContent||''})).slice(0,500)};});
}
async function preparePublicSearch(s){
  const dialogs=s.page.getByRole('dialog');
  for(let i=0;i<Math.min(await dialogs.count(),5);i++){
    const dialog=dialogs.nth(i);if(!await dialog.isVisible())continue;
    const text=(await dialog.innerText()).slice(0,1200);
    if(/captcha|verify you are|验证码|驗證碼/i.test(text))return {state:'restricted',diagnostic:{dialog:text}};
    const choice=dialog.getByRole('button',{name:/^(decline optional cookies|reject optional cookies|only essential cookies|reject all|not now|continue without logging in|暂不|稍后再说|仅必要cookies)$/i}).first();
    if(await choice.isVisible().catch(()=>false)){
      const label=await choice.innerText();await choice.click({timeout:4000});await s.page.waitForTimeout(500);
      s.events.push({action:'choose_public_entry_option',label,at:new Date().toISOString()});
      if(!await dialog.isVisible().catch(()=>false))continue;
    }
    return {state:/log in|sign in|登录|登入/i.test(text)?'needs_login':'needs_user_action',diagnostic:{dialog:text}};
  }
  return {state:'ready'};
}
export async function collectVisibleContact(s,company,{personName='',maxImages=2}={}){
  const state=await browserState(s);if(state!=='ready')return {state,fresh:false,blocks:[],channels:[],images:[],reason:state};
  if(!browserPlatformUrl(s.platform,s.page.url())||new URL(s.page.url()).pathname==='/')return {state:'restricted',fresh:false,blocks:[],channels:[],images:[],reason:'home_feed_or_non_public_business_page'};
  const snapshots=[];
  for(let i=0;i<3;i++){snapshots.push(await visibleDocument(s.page));if(i<2){await s.page.evaluate(()=>window.scrollBy(0,500));await s.page.waitForTimeout(350);}}
  const sourceUrl=publicPageUrl(s.page.url()),text=[...new Set(snapshots.map(d=>d.text))].join('\n'),links=[...new Map(snapshots.flatMap(d=>d.links).map(l=>[l.url,l])).values()];
  if(!text.trim()||!relatedBrowserText(text,company,personName))return {state:'unrelated',fresh:false,blocks:[],channels:[],images:[],reason:'no_related_readable_social_body'};
  const digest=hash(JSON.stringify([sourceUrl,text]));if(s.lastCapture===digest)return {state:'unchanged',fresh:false,blocks:[],channels:[],images:[],reason:'same_visible_material_already_collected'};
  const retrievedAt=new Date().toISOString(),result=contactText({url:sourceUrl,text,links,retrievedAt,companyId:company.id}),images=[];
  result.channels=result.channels.map(c=>({...c,scope:'unknown'}));
  result.channels.push(...publishedContactLinks({url:sourceUrl,text,links,personName,companyName:company.name,retrievedAt}));
  const channels=new Map();for(const c of result.channels){const key=JSON.stringify([c.kind,c.scope,c.personId||'',c.value]),old=channels.get(key);
    if(old)old.evidence=[...new Map([...old.evidence,...c.evidence].map(e=>[JSON.stringify(e),e])).values()];else channels.set(key,c);}
  result.channels=[...channels.values()];
  await s.page.evaluate(()=>window.scrollTo(0,0));
  const regions=s.page.locator('main,[role="main"]'),main=await regions.count()?regions.first():s.page.locator('body'),box=await main.boundingBox?.().catch(()=>null),viewport=s.page.viewportSize();
  if(box&&maxImages>0&&s.usage.screenshots<s.scope.maxScreenshots){
    const clip={x:Math.max(0,box.x),y:Math.max(0,box.y),width:Math.min(box.width,viewport.width-Math.max(0,box.x)),height:Math.min(box.height,viewport.height-Math.max(0,box.y))};
    if(clip.width>40&&clip.height>20){const bytes=await s.page.screenshot({type:'png',clip,animations:'disabled'});if(bytes.length>2097152)throw Error('BROWSER_IMAGE_TOO_LARGE');
      const contentHash=hash(bytes);images.push({id:'IMG-'+contentHash.slice(0,24),imageId:contentHash,sourceUrl,retrievedAt,contentHash,bytes,region:clip,needsVisualReview:true});s.usage.screenshots++;}
  }
  const first=result.blocks.find(b=>relatedBrowserText(b.text,company,personName));
  if(first&&!/\/search(?:\/|\?|$)/i.test(sourceUrl))result.channels.push({kind:'contact_page',scope:'unknown',value:sourceUrl,verification:'ownership_needs_review',evidence:[{id:first.id,sourceUrl,quote:first.text.slice(0,500),retrievedAt,contentHash:first.contentHash}]});
  s.lastCapture=digest;s.events.push({action:'fresh_social_capture',url:sourceUrl,characters:result.coverage.charactersRead,images:images.length,at:retrievedAt});
  return {...result,url:sourceUrl,links,images,fresh:true,method:'visible_social_browser',retrievedAt,searchSubmitted:s.events.some(e=>e.action==='search_submitted'),
    networkRequests:s.usage.networkRequests,events:s.events.slice(-60),coverage:{...result.coverage,complete:false,reason:'bounded_visible_social_research'}};
}
/** @param {any} s @param {any} company @param {{personName?:string,accounts?:any[]}} options */
export async function searchVisibleContacts(s,company,{personName='',accounts=[]}={}){
  if(s.busy)throw Error('BROWSER_SESSION_BUSY');s.busy=true;s.manual=false;
  try{
    if(s.usage.networkRequests>=s.scope.maxNetworkRequests||s.usage.pageReads>=s.scope.maxPageReads)return {state:'budget_exhausted',fresh:false,reason:'budget_exhausted',blocks:[],channels:[],images:[]};
    const state=await browserState(s);if(state!=='ready')return {state,fresh:false,reason:state,blocks:[],channels:[],images:[]};
    if(!browserPlatformUrl(s.platform,s.page.url()))return {state:'blocked',fresh:false,reason:'platform_navigation_failed',blocks:[],channels:[],images:[]};
    const entry=await preparePublicSearch(s);if(entry.state!=='ready')return {...entry,fresh:false,reason:'visible_entry_dialog',blocks:[],channels:[],images:[]};
    let input=await visibleSearch(s.page);
    if(!input){for(const role of ['button','link']){const menu=s.page.getByRole(role,{name:/^(search|cari|搜索|搜尋)$/i}).first();
      if(await menu.isVisible().catch(()=>false)){try{await menu.click({timeout:4000});}catch{
        const text=await s.page.locator('body').innerText().catch(()=> '');return {state:'needs_user_action',fresh:false,reason:'visible_search_control_obstructed',diagnostic:{visibleExcerpt:text.slice(-1600)},blocks:[],channels:[],images:[]};}
        s.events.push({action:'open_visible_search',platform:s.platform,at:new Date().toISOString()});break;}}}
    for(let i=0;!input&&i<12;i++){await s.page.waitForTimeout(500);const barrier=await browserState(s);if(barrier!=='ready')return {state:barrier,fresh:false,reason:barrier,blocks:[],channels:[],images:[]};input=await visibleSearch(s.page);}
    if(!input)return {state:'search_unavailable',fresh:false,reason:'visible_platform_search_field_not_found',blocks:[],channels:[],images:[]};
    const query=[personName,company.name].filter(Boolean).join(' ');
    await input.fill(query);if(await input.inputValue()!==query)throw Error('BROWSER_QUERY_NOT_FILLED');await input.press('Enter');
    s.events.push({action:'search_submitted',query,platform:s.platform,at:new Date().toISOString()});
    await s.page.waitForTimeout(2000);const after=await browserState(s);if(after!=='ready')return {state:after,fresh:false,reason:after,blocks:[],channels:[],images:[]};
    const resultEntry=await preparePublicSearch(s);if(resultEntry.state!=='ready')return {...resultEntry,fresh:false,reason:'visible_results_dialog',blocks:[],channels:[],images:[]};
    const observed=await visibleDocument(s.page),candidate=observed.links.find(l=>browserPlatformUrl(s.platform,l.url)&&new URL(l.url).pathname!=='/'&&!/\/search(?:\/|$)/i.test(new URL(l.url).pathname)&&relatedBrowserText(l.label,company,personName));
    if(candidate){const anchors=s.page.locator('a[href]');for(let i=0;i<Math.min(await anchors.count(),500);i++){
      const a=anchors.nth(i),href=await a.evaluate(a=>a.href);if(href===candidate.url&&await a.isVisible()){await a.click({timeout:10000});s.events.push({action:'open_observed_result',url:publicPageUrl(candidate.url),at:new Date().toISOString()});break;}}
    }else{const known=accounts.find(a=>browserPlatformUrl(s.platform,a.url)&&a.evidence?.length);
      if(known){await s.page.goto(known.url,{waitUntil:'domcontentloaded',timeout:20000});s.events.push({action:'open_evidenced_account',url:publicPageUrl(known.url),at:new Date().toISOString()});}}
    await s.page.waitForTimeout(1000);
    const expand=/^(see more|show more|experience|contact info|about|lihat lainnya|tentang|pengalaman|更多|工作经历|聯絡資料|关于)$/i;
    for(const role of ['button','tab','link']){const group=s.page.getByRole(role,{name:expand});for(let i=0;i<Math.min(await group.count(),2);i++){
      const item=group.nth(i);if(await item.isVisible()){const label=await item.innerText();await item.click({timeout:4000}).catch(()=>{});s.events.push({action:'expand_visible_information',label,at:new Date().toISOString()});}}}
    return await collectVisibleContact(s,company,{personName});
  }finally{s.busy=false;s.manual=true;}
}
