export function checkedRelatedPage(entity:any,url:string){
 const target=new URL(url),site=new URL(entity.website);
 if(!['http:','https:'].includes(target.protocol)||target.origin!==site.origin||target.username||target.password)throw Error('RELATED_PAGE_OUTSIDE_WEBSITE');
 const links=(entity.websitePages||[]).flatMap((p:any)=>p.links||[]);
 if(!links.includes(target.href))throw Error('RELATED_PAGE_NOT_OBSERVED');
 return target.href;
}
export function relatedPageChoices(entity:any){
 if(!entity?.website)return [];
 const pages=entity.websitePages||[],origin=new URL(entity.website).origin;
 const links=[...(entity.unreadRelatedLinks||[]),...pages.flatMap((p:any)=>(p.links||[]).filter((url:string)=>/\/(?:about|company|story|[^/]+-story|store-locator|locations?|branches|franchis\w*|contact)(?:\/|[-_])/i.test(url)))];
 return [...new Set<string>(links)].filter(url=>{
  try{return new URL(url).origin===origin&&!pages.some((p:any)=>p.url===url&&(p.content||p.readFailure));}catch{return false;}
 }).slice(0,16);
}
