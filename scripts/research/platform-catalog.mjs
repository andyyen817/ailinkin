export const legacyPlatforms=['FB','X','IG','小红书','TikTok','Reddit','网页'];
export const contactPlatforms=['网页','FB','IG','Threads','LinkedIn','X','Reddit','小红书','TikTok'];
/** @type {Record<string,{label:string,domains:string[],canonical:string|null}>} */
export const platformCatalog={
  FB:{label:'Facebook',domains:['facebook.com'],canonical:'facebook.com'},
  X:{label:'X',domains:['x.com','twitter.com'],canonical:'x.com'},
  IG:{label:'Instagram',domains:['instagram.com'],canonical:'instagram.com'},
  Threads:{label:'Threads',domains:['threads.com','threads.net'],canonical:'threads.com'},
  LinkedIn:{label:'LinkedIn',domains:['linkedin.com'],canonical:'linkedin.com'},
  Reddit:{label:'Reddit',domains:['reddit.com'],canonical:'reddit.com'},
  小红书:{label:'小红书',domains:['xiaohongshu.com'],canonical:'xiaohongshu.com'},
  TikTok:{label:'TikTok',domains:['tiktok.com'],canonical:'tiktok.com'},
  网页:{label:'官网',domains:[],canonical:null},
};
export function platformsFor(project={}){
  if(project.researchPlatforms){
    if(!Array.isArray(project.researchPlatforms)||!project.researchPlatforms.length||project.researchPlatforms.some(p=>!platformCatalog[p]))throw Error('INVALID_RESEARCH_PLATFORMS');
    return [...new Set(project.researchPlatforms)];
  }
  return [...new Set([...legacyPlatforms,...(Array.isArray(project.additionalPlatforms)?project.additionalPlatforms.filter(p=>platformCatalog[p]):[])])];
}
export function socialPlatform(url){
  try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
    return Object.keys(platformCatalog).find(p=>platformCatalog[p].domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))||null;
  }catch{return null;}
}
