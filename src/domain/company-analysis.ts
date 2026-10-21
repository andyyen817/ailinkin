import {z} from 'zod';

const line = z.string().trim().min(1).max(800);
const lines = z.array(line).max(20);
export const companyAnalysisInput = z.object({
  companyName: z.string().trim().min(1).max(200),
  business: z.string().trim().max(12000).default(''),
  website: z.union([z.literal(''), z.url().refine(v => /^https?:\/\//.test(v))]).default(''),
  details: z.string().trim().max(12000).default(''),
  intent: z.string().trim().max(2000).default(''),
  market: z.string().trim().max(200).default(''),
  marketMode:z.enum(['headquarters','operating_presence','service_coverage']).optional(),
  offerings: z.array(z.object({name: line, description: z.string().trim().min(1).max(3000),
    capabilities: z.string().trim().max(3000).default(''), limitations: z.string().trim().max(3000).default(''),
  }).strict()).max(12).optional(),
  answers: z.array(z.object({questionId: line, question: line, answer: line}).strict()).max(12).default([]),
  documents: z.array(z.object({name: line, text: z.string().trim().min(1).max(20000)}).strict()).max(4).default([]),
}).strict().refine(v => Boolean(v.business || v.website || v.documents.length || v.offerings?.length), {
  message: '请提供业务介绍、官网或资料内容中的至少一种',
});
export type CompanyAnalysisInput = z.infer<typeof companyAnalysisInput>;
export type AnalysisSource = {id: string; label: string; text: string; kind: 'provided' | 'website'};
const factSchema = z.object({id: line, claim: line, sourceId: line, quote: line}).strict();
const hypothesisSchema = z.object({
  id: line, label: line, role: line, application: line, why: line,
  factIds: z.array(line).min(1).max(20), unknowns: lines,
  priority: z.enum(['优先', '备选', '待补资料']),
  decisionRoles: lines, queryTerms: z.array(line).min(1).max(8),
}).strict();
export const analysisReportSchema = z.object({
  quality: z.unknown().optional(),
  summary: line, businessModel: line, capabilities: lines, limitations: lines, conflicts: lines,
  facts: z.array(factSchema).max(40),
  profiles: z.array(hypothesisSchema).max(12),
  questions: z.array(z.object({id: line, text: line, reason: line}).strict()).max(3),
}).strict().refine(v => v.profiles.length > 0 || v.questions.length > 0 || Boolean(v.quality), {
  message: '信息不足时必须说明需要补充的关键问题',
});
export type AnalysisReport = z.infer<typeof analysisReportSchema>;
export function inputSources(input: CompanyAnalysisInput): AnalysisSource[] {
  const fields = [['business', '主营业务', input.business], ['details', '能力与限制', input.details],
    ['intent', '拓展想法', input.intent], ['market', '目标市场', input.market]];
  return [
    ...fields.filter(([, , text]) => text).map(([id, label, text]) => ({id, label, text, kind: 'provided' as const})),
    ...(input.offerings || []).map((p, i) => ({id: `offering-${i}`, label: p.name, kind: 'provided' as const,
      text: [`产品／服务：${p.name}`, p.description, p.capabilities, p.limitations].filter(Boolean).join('\n')})),
    ...input.documents.map((d, i) => ({id: `document-${i}`, label: d.name, text: d.text, kind: 'provided' as const})),
    ...input.answers.map((a, i) => ({id: `answer-${i}`, label: a.question, text: a.answer, kind: 'provided' as const})),
  ];
}
export function validateAnalysisReport(raw: unknown, sources: AnalysisSource[]): AnalysisReport {
  const report = analysisReportSchema.parse(raw);
  const facts = new Set<string>();
  for (const fact of report.facts) {
    const source = sources.find(s => s.id === fact.sourceId);
    if (!source || !source.text.includes(fact.quote) || facts.has(fact.id)) throw Error('ANALYSIS_INVALID_EVIDENCE');
    facts.add(fact.id);
  }
  const ids = new Set<string>();
  for (const profile of report.profiles) {
    if (ids.has(profile.id) || profile.factIds.some(id => !facts.has(id))) throw Error('ANALYSIS_INVALID_PROFILE');
    ids.add(profile.id);
  }
  if (new Set(report.questions.map(q => q.id)).size !== report.questions.length) throw Error('ANALYSIS_DUPLICATE_QUESTION');
  return report;
}
