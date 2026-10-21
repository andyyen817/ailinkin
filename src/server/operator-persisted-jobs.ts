import 'server-only';
import {identityDb} from './db';
export function pendingPageScope(rows:any[],tenantId:string,actorId:string){
  for(const row of rows){
    if(process.env.OPERATOR_WORKER_CAMPAIGN&&row.id!==process.env.OPERATOR_WORKER_CAMPAIGN)continue;
    if(row.tenant_id!==tenantId||row.data.project.tenantId!==tenantId)continue;
    for(const batch of row.data.operatorBatches||[]){
      if(process.env.OPERATOR_WORKER_MODE&&batch.mode!==process.env.OPERATOR_WORKER_MODE)continue;
      if(process.env.OPERATOR_WORKER_BATCH&&batch.id!==process.env.OPERATOR_WORKER_BATCH)continue;
      if(!batch.selfService||batch.actorId!==actorId||!['checking','running','exporting'].includes(batch.state))continue;
      if(batch.lease&&Date.parse(batch.lease.until)>Date.now())continue;
      const scope=row.data.operatorScopes?.find((s:any)=>s.id===batch.scopeId);
      if(scope?.tenantId===tenantId&&scope.actorId===actorId&&scope.anchorCampaignId===row.id)return scope;
    }
  }
  return null;
}
export function operatorPrincipalFilter(){return {disabled:false,OR:[{platformRole:{not:'platform_admin'}},{twoFactorEnabled:true}],...(process.env.OPERATOR_WORKER_ACTOR?{id:process.env.OPERATOR_WORKER_ACTOR}:{})};}
export async function nextPersistedOperatorScope(work:any){
  const principals=await identityDb().user.findMany({where:operatorPrincipalFilter(),select:{id:true},take:100});
  for(const principal of principals){
    const memberships=await identityDb().$queryRaw<any[]>`SELECT * FROM public.my_memberships(${principal.id})`;
    for(const m of memberships.filter(m=>m.role==='owner'&&m.status==='active')){
      if(process.env.OPERATOR_WORKER_TENANT&&process.env.OPERATOR_WORKER_TENANT!==m.tenant_id)continue;
      const scope=await work({tenantId:m.tenant_id,actorId:principal.id},async(tx:any)=>{
        const rows=await tx.$queryRaw`SELECT id,tenant_id,data FROM research_campaign WHERE data ? 'operatorDirection' ORDER BY updated_at ASC LIMIT 100`;
        return pendingPageScope(rows,m.tenant_id,principal.id);
      });
      if(scope)return scope;
    }
  }
  return null;
}
export function writableOperatorRows(rows:any[],scope:any){
  return scope.selfService?rows.filter(r=>r.id===scope.anchorCampaignId):rows;
}
