import 'server-only';
import {randomUUID,createHash} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import {companyAnalysisInput, inputSources, type CompanyAnalysisInput, type AnalysisSource, type AnalysisReport} from '@/domain/company-analysis';
import {analysisVersionFor, analysisFingerprint, draftGroups} from './company-analysis-model';
import {AccessError} from './policy';
import {emptyLedger} from '../../scripts/research/schema.mjs';
import {checkedQuality,recheckedQuality,reviewReport} from './company-reviewed-analysis';
import {questionDraftSchema,type QuestionDraft} from '@/domain/company-matters';
import type {Statement} from '@/domain/company-evidence';

export type AnalysisData = {input: CompanyAnalysisInput; model: string; schemaVersion: string; sources: AnalysisSource[];
  report: AnalysisReport | null; groups: ReturnType<typeof draftGroups>; ledger: any;
  previousId?: string; pendingQuestions?: QuestionDraft[]; reusedStatements?: Statement[]};
export type AnalysisRow = {id: string; tenant_id: string; state: string; message: string; version: number; data: AnalysisData; created_at: Date; updated_at: Date;has_model_origin?:boolean};
export async function analysisRows(tx: Prisma.TransactionClient) {
  return tx.$queryRaw<AnalysisRow[]>`WITH RECURSIVE recent AS (
    SELECT * FROM company_analysis ORDER BY created_at DESC,id LIMIT 20
  ), lineage AS (
    SELECT id root,id,tenant_id,data->>'previousId' parent,ARRAY[id] seen,0 depth,
      data->'report'<>'null'::jsonb AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(data->'ledger'->'requests','[]'::jsonb)) q WHERE q->>'service'='ai' AND q->>'status'='done') has_model FROM recent
    UNION ALL
    SELECT l.root,p.id,p.tenant_id,p.data->>'previousId',l.seen||p.id,l.depth+1,
      p.data->'report'<>'null'::jsonb AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p.data->'ledger'->'requests','[]'::jsonb)) q WHERE q->>'service'='ai' AND q->>'status'='done')
    FROM lineage l JOIN company_analysis p ON p.id::text=l.parent AND p.tenant_id=l.tenant_id
    WHERE l.depth<64 AND NOT p.id=ANY(l.seen)
  ) SELECT r.*,EXISTS(SELECT 1 FROM lineage l WHERE l.root=r.id AND l.has_model) has_model_origin
    FROM recent r ORDER BY r.created_at DESC,r.id`;
}
export async function analysisRow(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<AnalysisRow[]>`SELECT * FROM company_analysis WHERE id=${id}`;
  if (!rows.length) throw new AccessError('ANALYSIS_NOT_FOUND', 404);
  return rows[0];
}
export function inheritedInput(raw:unknown,parent?:AnalysisRow) {
  const input=companyAnalysisInput.parse(raw);
  if(!parent) return input;
  const answers=[...parent.data.input.answers.filter(a=>!input.answers.some(n=>n.questionId===a.questionId)),...input.answers];
  return companyAnalysisInput.parse({...input,answers});
}
export function analysisDataFingerprint(input:CompanyAnalysisInput,data:AnalysisData) {
  const base=analysisFingerprint(input,data.model);
  if(data.report)return createHash('sha256').update(JSON.stringify([base,data.pendingQuestions || [],data.report])).digest('hex');
  return data.pendingQuestions?.length?createHash('sha256').update(JSON.stringify([base,data.pendingQuestions])).digest('hex'):base;
}
export function prepareAnalysisData(input:CompanyAnalysisInput,model:string,tenant:string,parent?:AnalysisRow):AnalysisData {
  const sources=inputSources(input),old=parent?.data;
  const quality=old?(checkedQuality(old.report,old.input,old.sources) || recheckedQuality(old.report,old.input,old.sources)):null;
  const contentWithoutAnswers=(value:CompanyAnalysisInput)=>JSON.stringify({...companyAnalysisInput.parse(value),companyName:'',answers:[]});
  const changedSource=old && contentWithoutAnswers(old.input)!==contentWithoutAnswers(input);
  const shown=old?.report?.quality as {questions?:QuestionDraft[]} | undefined;
  const previousContexts=quality?[...quality.pending,...(shown?.questions || []),...quality.questions]:old?.pendingQuestions || [];
  // Answers retain their original subject. Unanswered wording can depend on superseded capabilities.
  const contexts=changedSource?previousContexts.filter(q=>input.answers.some(a=>a.questionId===q.id)):previousContexts;
  const pendingQuestions=[...new Map(contexts.map(q=>[JSON.stringify([q.id,q.text]),questionDraftSchema.parse(q)])).values()].slice(-60);
  const data:AnalysisData={input,model,schemaVersion:analysisVersionFor(input),sources,report:null,groups:[],
    ledger:emptyLedger({tenantId:tenant,product:input.companyName,country:input.market}),previousId:parent?.id,pendingQuestions};
  if(quality && old?.model===model && old.schemaVersion===data.schemaVersion) {
    data.reusedStatements=quality.draft.statements.filter(s=>quality.statements.some(a=>a.id===s.id) &&
      sources.some(current=>current.id===s.sourceId && old.sources.some(prior=>prior.id===current.id && prior.text===current.text)));
  }
  const content=(value:CompanyAnalysisInput)=>JSON.stringify({...companyAnalysisInput.parse(value),companyName:''});
  if(old && content(old.input)===content(input)) {
    if(old.ledger.requests.some((r:any)=>['pending','unknown'].includes(r.status))) throw new AccessError('ANALYSIS_BUSY_OR_UNRESOLVED',409);
    if(quality && old.model===model && old.schemaVersion===data.schemaVersion) {
      data.sources=[...sources,...old.sources.filter(s=>s.kind==='website')];
      data.report=reviewReport(input,data.sources,quality.draft,quality.pending);
      data.groups=draftGroups(input,data.report);
    }
  }
  return data;
}
export async function createAnalysis(tx: Prisma.TransactionClient, tenant: string, actor: string, raw: unknown, model: string,previousId?:string) {
  const parent=previousId?await analysisRow(tx,previousId):undefined;
  if(parent && parent.tenant_id!==tenant) throw new AccessError('ANALYSIS_NOT_FOUND',404);
  const input = inheritedInput(raw,parent);
  const data = prepareAnalysisData(input,model,tenant,parent);
  const fingerprint=analysisDataFingerprint(input,data);
  await tx.$executeRaw`INSERT INTO company_analysis(id,tenant_id,actor_id,input_hash,data,state,message)
    VALUES(${randomUUID()},${tenant},${actor},${fingerprint},${JSON.stringify(data)}::jsonb,${data.report?'complete':'draft'},${data.report?'已复用当前版本的分析，未新增模型调用。':'资料已保存'})
    ON CONFLICT(tenant_id,input_hash) DO NOTHING`;
  const rows = await tx.$queryRaw<AnalysisRow[]>`SELECT * FROM company_analysis WHERE tenant_id=${tenant} AND input_hash=${fingerprint}`;
  if (!rows.length) throw new AccessError('ANALYSIS_NOT_FOUND', 404);
  return rows[0];
}
export async function claimAnalysis(tx: Prisma.TransactionClient, id: string) {
  const row = await analysisRow(tx, id);
  if (row.state === 'complete') return row;
  if (['running', 'unknown'].includes(row.state) || row.data.ledger.requests.some((r: any) => ['pending', 'unknown'].includes(r.status))) {
    throw new AccessError('ANALYSIS_BUSY_OR_UNRESOLVED', 409);
  }
  const rows = await tx.$queryRaw<AnalysisRow[]>`UPDATE company_analysis SET state='running',version=version+1,updated_at=now()
    WHERE id=${id} AND version=${row.version} RETURNING *`;
  if (!rows.length) throw new AccessError('ANALYSIS_VERSION_CONFLICT', 409);
  return rows[0];
}
export async function saveAnalysis(tx: Prisma.TransactionClient, row: AnalysisRow, state: string, message: string,
  budget = {maxRequests: 0, maxSpendUsd: 0}) {
  // Reservations are shared by all analysis records in this tenant, not reset by creating a new input.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${row.tenant_id + '-company-analysis'}))`;
  const totals = await tx.$queryRaw<{count: number; spend: number}[]>`SELECT count(r)::int AS count,
    COALESCE(sum((r->>'reservedCost')::numeric),0)::float8 AS spend FROM company_analysis c
    CROSS JOIN LATERAL jsonb_array_elements(c.data->'ledger'->'requests') r WHERE c.tenant_id=${row.tenant_id} AND c.id<>${row.id}`;
  const own = row.data.ledger.requests;
  if (own.some((r: any) => r.status === 'pending') &&
      (totals[0].count + own.length > budget.maxRequests || totals[0].spend + own.reduce((n: number, r: any) => n + r.reservedCost, 0) > budget.maxSpendUsd)) {
    throw new AccessError('ANALYSIS_BUDGET_EXCEEDED', 409);
  }
  const rows = await tx.$queryRaw<AnalysisRow[]>`UPDATE company_analysis SET data=${JSON.stringify(row.data)}::jsonb,state=${state},
    message=${message},version=version+1,updated_at=now() WHERE id=${row.id} AND version=${row.version} RETURNING *`;
  if (!rows.length) throw new AccessError('ANALYSIS_VERSION_CONFLICT', 409);
  // Keep the mutable data object held by the in-flight transport checkpoint.
  // Replacing it with the JSONB round-trip copy loses later HTTP results.
  Object.assign(row, {...rows[0], data: row.data}); return row;
}
