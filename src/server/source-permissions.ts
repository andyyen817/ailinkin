import 'server-only';

export type SourceObservation={
  provider:string;ownerTenantId:string|null;
  kind:'organization_fact'|'person_data'|'private_note'|'communication';
  reusePolicy:'tenant_only'|'public_company'|'licensed_platform';
};
export type SourceGrant={provider:string;evidenceId:string;reviewed:boolean;expiresAt:string;
  commercialDisplay:boolean;crossTenantCompanyReuse:boolean};
export function activeGrant(provider:string,grants:SourceGrant[]=[],now=Date.now()){
  return grants.find(g=>g.provider===provider&&g.reviewed&&Boolean(g.evidenceId.trim())&&
    Number.isFinite(Date.parse(g.expiresAt))&&Date.parse(g.expiresAt)>now);
}
export function mayReuseSource(observation:SourceObservation,tenantId:string,grants:SourceGrant[]=[]){
  if(observation.ownerTenantId===tenantId)return true;
  if(observation.kind!=='organization_fact')return false;
  if(observation.reusePolicy==='tenant_only')return false;
  if(observation.provider==='apollo'){
    return Boolean(activeGrant('apollo',grants)?.crossTenantCompanyReuse)&&observation.reusePolicy==='licensed_platform';
  }
  if(observation.reusePolicy==='public_company')return true;
  return Boolean(activeGrant(observation.provider,grants)?.crossTenantCompanyReuse);
}
export function apolloPurposeAllowed(tenantId:string,trialTenant:string|undefined,purpose:string,
  grants:SourceGrant[]=[]){
  if(purpose==='internal_test')return Boolean(trialTenant)&&tenantId===trialTenant;
  return purpose==='commercial_saas'&&Boolean(activeGrant('apollo',grants)?.commercialDisplay);
}
