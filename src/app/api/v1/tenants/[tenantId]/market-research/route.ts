import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {withTenant} from '@/server/tenant';
import {json,failure,mutationOrigin} from '@/server/http';
import {analysisRow} from '@/server/company-analysis-store';
import {campaigns} from '@/server/research-store';
import {marketResearchInput,assertMarketBudget} from '@/domain/market-research';
import {marketEntries,prepareMarket,setMarket,persistMarket,readMarketScope,marketExecutionStatus,releaseOwnedMarketLease} from '@/server/market-research-store';
import {executeMarketResearch} from '@/server/market-research-execution';
import {marketKey} from '@/domain/target-markets';
import {AccessError} from '@/server/policy';
import {sharedBudgetGuard} from '@/server/shared-research-budget';
import {MARKET_SCHEMA_ERROR,MARKET_SCHEMA_MESSAGE,MARKET_INCOMPLETE_MESSAGE} from '@/domain/market-model-output';
export const runtime='nodejs';export const maxDuration=180;
type Context={params:Promise<{tenantId:string}>};
export async function GET(request:Request,{params}:Context){
  try{const {tenantId}=await params,id=z.uuid().parse(new URL(request.url).searchParams.get('analysisId')),scope=await readMarketScope();
    return json(await withTenant(request,tenantId,async tx=>{const row=await analysisRow(tx,id);if(row.tenant_id!==tenantId)throw new AccessError('ANALYSIS_NOT_FOUND',404);
      return {entries:marketEntries(row),execution:marketEntries(row).map(s=>({market:s.market,...marketExecutionStatus(row,s.market,scope)}))};}));
  }catch(e){return failure(e);}
}
export async function POST(request:Request,{params}:Context){
  try{
    mutationOrigin(request);const {tenantId}=await params,reader=request.body?.getReader();if(!reader)throw new AccessError('INVALID_INPUT',400);
    let size=0;const chunks:Uint8Array[]=[];try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>16384){await reader.cancel();throw new AccessError('INPUT_TOO_LARGE',413);}chunks.push(p.value);}}finally{reader.releaseLock();}
    const input=marketResearchInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))),scope=await readMarketScope(),token=randomUUID();
    const result=await withTenant(request,tenantId,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':market:'+input.analysisId}))`;
      const row=await analysisRow(tx,input.analysisId);if(row.tenant_id!==tenantId)throw new AccessError('ANALYSIS_NOT_FOUND',404);
      if(row.version!==input.expectedVersion)throw new AccessError('ANALYSIS_VERSION_CONFLICT',409);const before=JSON.stringify(row.data);
      const snapshot=prepareMarket(row,input.market,await campaigns(tx),scope);
      if(input.action!=='prepare'){
        if(!marketExecutionStatus(row,input.market,scope).enabled)throw new AccessError('MARKET_SCOPE_REQUIRED',403);
        const active=marketEntries(row).find(s=>s.lease&&Date.parse(s.lease.until)>Date.now());if(active)throw new AccessError('MARKET_BUSY_OR_UNKNOWN',409);
        snapshot.lease={token,until:new Date(Date.now()+180000).toISOString()};
      }
      const sharedRequests=marketEntries(row).filter(s=>marketKey(s.market)!==marketKey(input.market)).flatMap(s=>s.requests||[]);
      setMarket(row,snapshot);await persistMarket(tx,row,before);return {row,snapshot,sharedRequests};
    },true);
    if(input.action!=='prepare'){try{await executeMarketResearch(result.snapshot,{tenantId,analysisId:result.row.id,inputHash:result.snapshot.inputHash,sharedRequests:result.sharedRequests,collectOnly:input.action==='collect',beforeSend:sharedBudgetGuard(request,tenantId,scope,result.row.id)},scope,
      async()=>{await withTenant(request,tenantId,async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':market:'+input.analysisId}))`;const fresh=await analysisRow(tx,input.analysisId),before=JSON.stringify(fresh.data);
        const current=marketEntries(fresh).find(s=>marketKey(s.market)===marketKey(input.market));if(current?.lease?.token!==token)throw new AccessError('MARKET_LEASE_LOST',409);
        const other=marketEntries(fresh).filter(s=>s!==current).flatMap(s=>s.requests||[]).filter((r:any)=>r.scopeId===scope!.id),own=result.snapshot.requests.filter((r:any)=>r.scopeId===scope!.id);
        if(other.length+own.length>scope!.maxSearchRequests+scope!.maxModelRequests||Number([...other,...own].reduce((n:number,r:any)=>n+(r.reservedCost||0),0).toFixed(8))>scope!.maxSpendUsd)throw new AccessError('MARKET_SHARED_BUDGET_REACHED',409);
        assertMarketBudget([...other,...own],scope!);
        setMarket(fresh,result.snapshot);await persistMarket(tx,fresh,before);
      },true);}, {LANGSEARCH_API_KEY:process.env.LANGSEARCH_API_KEY,DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY});
    }finally{await withTenant(request,tenantId,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId+':market:'+input.analysisId}))`;
      const fresh=await analysisRow(tx,input.analysisId),before=JSON.stringify(fresh.data),current=marketEntries(fresh).find(s=>marketKey(s.market)===marketKey(input.market));
      if(releaseOwnedMarketLease(current,token)){setMarket(fresh,current);await persistMarket(tx,fresh,before);}
    },true);}}
    return json({snapshot:result.snapshot,execution:marketExecutionStatus(result.row,input.market,scope),sent:0});
  }catch(e){if(e instanceof Error&&/^(MARKET_STAGE_BUDGET_REACHED|MARKET_SHARED_BUDGET_REACHED|SHARED_BUDGET_REACHED)$/.test(e.message))return json({error:e.message,message:'本批额度已到；已收集的资料和原报告已保留。请查看本步记录。'},409);
    if(e instanceof Error&&[MARKET_SCHEMA_ERROR,'MARKET_MODEL_INCOMPLETE'].includes(e.message))return json({error:e.message,message:e.message===MARKET_SCHEMA_ERROR?MARKET_SCHEMA_MESSAGE:MARKET_INCOMPLETE_MESSAGE},422);return failure(e);}
}
