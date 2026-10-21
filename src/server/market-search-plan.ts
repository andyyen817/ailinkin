import {createHash} from 'node:crypto';
export function marketSearchPlans(scope:any){
  const plans=scope.searchPlans||scope.queries.map((query:string)=>({query,count:50,maxCharacters:2000,includeDomains:[],excludeDomains:[]}));
  if(plans.some((p:any)=>!scope.queries.includes(p.query))||new Set(plans.map((p:any)=>p.query)).size!==plans.length||plans.length!==scope.queries.length)throw Error('MARKET_PLAN_NOT_APPROVED');
  return plans.map((p:any)=>({...p,key:createHash('sha256').update(JSON.stringify([p.query.trim(),p.count,p.maxCharacters,[...p.includeDomains].sort(),[...p.excludeDomains].sort()])).digest('hex')}));
}
