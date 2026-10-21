import {matchesEntityText,normalizeName,queryNames} from './locator-plan.mjs';
const domain=u=>{try{return new URL(u).hostname.replace(/^www\./,'');}catch{return null;}};
export function ownershipNames(entity){
 const names=queryNames(entity);
 for(const h of entity.resolution?.hits||[]){
  if(h.provider!=='apollo'||!h.sourceId||domain(h.url)!==domain(entity.website)||!matchesEntityText(entity,h.declaredName))continue;
  const label=h.declaredName.split(' (')[0].trim();
  if(normalizeName(label).length>=5)names.push(label);
 }
 return [...new Set(names)].slice(0,6);
}
export function ownershipNamePresent(entity,text){
 const normalized=' '+normalizeName(text)+' ';
 return ownershipNames(entity).some(n=>normalized.includes(' '+normalizeName(n)+' '));
}
