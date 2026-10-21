export function compileSearchSpec(project,keyword){
  const specs=project.buyerGroup?.searchSpecs;
  if(!specs)return null; // Historical adapter calls remain readable; SaaS preflight enforces new scopes.
  const spec=specs.find(s=>s.query===keyword);
  if(!spec||!spec.business?.trim()||!spec.market?.trim()||
    !['buys_from_us','refers_orders'].includes(spec.direction))throw Error('SEARCH_SPEC_NOT_READY');
  if(project.discoveryProvider==='apollo'&&spec.marketMode!=='headquarters'){
    throw Error('APOLLO_REQUIRES_HEADQUARTERS_SCOPE');
  }
  return {webQuery:spec.query,organizationKeywords:[spec.business.trim()],
    market:spec.market,marketMode:spec.marketMode,expectedBuyerRole:spec.buyerRole,
    verification:[...(spec.verify||[])]};
}
