import {z} from 'zod';
import {withTenant} from '@/server/tenant';
import {json, failure, mutationOrigin} from '@/server/http';
import {analysisRows, analysisRow, createAnalysis, claimAnalysis, saveAnalysis} from '@/server/company-analysis-store';
import {companyAnalysisConfig, executeCompanyAnalysis, presentAnalysis} from '@/server/company-analysis-service';
import {AccessError} from '@/server/policy';
import {analysisSearchPlan} from '@/server/analysis-search';
import {createCampaign} from '@/server/research-store';
export const runtime = 'nodejs';
export const maxDuration = 180;
type Context = {params: Promise<{tenantId: string}>};
const actionSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('create'), input: z.unknown(),previousId:z.uuid().optional()}).strict(),
  z.object({action: z.literal('run'), id: z.uuid()}).strict(),
  z.object({action: z.literal('plan'), id: z.uuid(), profileId:z.string().min(1).max(800),market:z.string().trim().min(1).max(100).optional(),relatedCampaignIds:z.array(z.uuid()).max(100).optional()}).strict(),
  z.object({action:z.literal('search'),id:z.uuid(),profileId:z.string().min(1).max(800),expectedVersion:z.number().int().min(1),
    market:z.string().trim().min(1).max(100).optional(),target:z.number().int().min(1).max(10000).optional(),discoveryMode:z.literal('coverage').optional(),expectedTarget:z.number().int().min(1).max(10000).optional(),discoveryProvider:z.enum(['web','apollo']),maxRequests:z.number().int().min(0).max(10000),
    maxSpendUsd:z.number().min(0).max(10000),maxApolloCredits:z.number().int().min(1).max(5),relatedCampaignIds:z.array(z.uuid()).max(100).optional()}).strict().refine(v=>v.discoveryMode==='coverage'||v.target!==undefined,'SEARCH_COUNT_OR_COVERAGE_REQUIRED'),
]);
async function inputFor(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new AccessError('INVALID_INPUT', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 131072) {await reader.cancel(); throw new AccessError('INPUT_TOO_LARGE', 413);}
      chunks.push(part.value);
    }
  } finally {reader.releaseLock();}
  return actionSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
export async function GET(request: Request, context: Context) {
  try {
    const {tenantId} = await context.params;
    const id = new URL(request.url).searchParams.get('id');
    const rows = await withTenant(request, tenantId, tx => id ? analysisRow(tx, z.uuid().parse(id)).then(row => [row]) : analysisRows(tx));
    const options = companyAnalysisConfig(tenantId);
    return json({analyses: rows.map(presentAnalysis), missing: options.missing});
  } catch (error) {return failure(error);}
}
export async function POST(request: Request, context: Context) {
  try {
    mutationOrigin(request);
    const {tenantId} = await context.params, input = await inputFor(request);
    const options = companyAnalysisConfig(tenantId);
    if(input.action==='plan')return json({plan:await withTenant(request,tenantId,async tx=>analysisSearchPlan(tx,await analysisRow(tx,input.id),input.profileId,input.relatedCampaignIds,input.market))});
    if(input.action==='search'){
      const result=await withTenant(request,tenantId,(tx,actor)=>createCampaign(tx,tenantId,actor.userId,{
        analysis:{id:input.id,profileId:input.profileId,version:input.expectedVersion,market:input.market,relatedCampaignIds:input.relatedCampaignIds},product:'企业分析',country:'待载入',
        ...(input.discoveryMode==='coverage'?{discoveryMode:input.discoveryMode,expectedTarget:input.expectedTarget}:{target:input.target}),discoveryProvider:input.discoveryProvider,maxRequests:input.maxRequests,maxSpendUsd:input.maxSpendUsd,maxApolloCredits:input.maxApolloCredits,
      }),true);
      return json({campaignId:result.id},201);
    }
    if (input.action === 'create') {
      const row = await withTenant(request, tenantId, (tx, actor) => createAnalysis(tx, tenantId, actor.userId, input.input, options.config.model || 'unconfigured',input.previousId), true);
      return json({analysis: presentAnalysis(row)}, 201);
    }
    const row = await withTenant(request, tenantId, tx => claimAnalysis(tx, input.id), true);
    await executeCompanyAnalysis(row, async (state, message, budget) => {
      await withTenant(request, tenantId, tx => saveAnalysis(tx, row, state, message, budget), true);
    }, options);
    return json({analysis: presentAnalysis(row)});
  } catch (error) {return failure(error);}
}
