export function firstPartyCandidate(entity:any,url:string){
  let host;try{host=new URL(url).hostname.replace(/^www\./,'').toLowerCase();}catch{return false;}
  const known=(entity.officialCandidates||[]).some((c:any)=>c.url===url&&c.provenance!=='observed_source_url'&&c.quote?.includes(url));
  if(known)return true;
  const neutral=new Set(['the','and','company','limited','ltd','inc','corporation','indonesia','philippines','international']);
  const names=[entity.name,...(entity.aliases||[]).filter((a:any)=>a.quote).map((a:any)=>a.name)].filter(Boolean);
  return names.some((name:string)=>{
    const words=name.toLowerCase().match(/[a-z0-9]+/g)||[],packed=words.join(''),domain=host.split('.').slice(0,-1).join('').replace(/[^a-z0-9]/g,'');
    return packed.length>=4&&domain.includes(packed)||words.some(w=>w.length>=4&&!neutral.has(w)&&domain.includes(w));
  });
}
