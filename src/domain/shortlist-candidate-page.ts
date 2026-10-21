import {matchesEntityText} from '../../scripts/research/locator-plan.mjs';
export function checkedCandidatePage(entity:any,url:string){
 const found=entity.resolution?.hits?.find((h:any)=>h.provider==='apollo'&&h.sourceId&&h.url===url&&matchesEntityText(entity,h.declaredName));
 if(!found)throw Error('WEBSITE_CANDIDATE_NOT_OBSERVED');
 const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error('INVALID_WEBSITE_CANDIDATE');
 return parsed.href;
}
