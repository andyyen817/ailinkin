import {z} from 'zod';
import type {AnalysisSource} from './company-analysis';

const text = z.string().trim().min(1).max(800);
export const statementSchema = z.object({
  id: text, sourceId: text, quote: text.describe('逐字引用一条独立陈述，保留其否定、条件和时间；不要把整份资料作为每个事实的引用'),
  kind: z.enum(['business', 'ability', 'limitation', 'goal', 'unknown']),
  attribute: text, product: z.string().max(200).describe('仅填写本条原文逐字出现的产品；原文未明示则为空字符串，不从其他来源推断'), region: z.string().max(200),
  period: z.enum(['current', 'past', 'planned', 'unknown']),
}).strict();
export type Statement = z.infer<typeof statementSchema>;
export type EvidenceIssue = {id: string; reason: string};
export type CheckedStatement = Statement & {context: string; provenance: '企业提供' | '官网陈述'};
export const normalText = (v: string) => v.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const goal = /希望|计划|打算|拟在|将来|未来|明年|有意|想要|想开拓|目标市场|\b(plan|hope|intend|aim|will|would like|target market)\b/i;
const unknown = /不确定|尚未|未说明|未提供|(?:没有|未).{0,3}提供.{0,8}(证明|资料|信息|说明|报告)|待核实|不知道|未知|\b(unknown|uncertain|not specified|not verified)\b/i;
const negative = /不提供|不能|没有|不负责|不支持|不做|未具备|无法|不销售|不承接|不再接|不承担|不接受|不承诺|\b(no|cannot|unable|do not|don't|not available)\b/i;
const conditional = /如果|假如|前提|取决于|视情况|若|\b(if|subject to|depending on)\b/i;
const historical = /曾经|曾向|以前|过去|去年|\b(previously|formerly|last year|used to)\b/i;
const scopeText=(value:string)=>normalText(value).replace(/\boverseas\b/g,'海外').replace(/\bdomestic\b/g,'国内').replace(/\b(sweden|sverige)\b/g,'瑞典');
export function sourceContext(source: AnalysisSource, quote: string) {
  const index = source.text.indexOf(quote);
  if (index < 0) return '';
  // Preserve the complete sentence, including negation/conditions outside the selected quote.
  const before = source.text.slice(0, index), after = source.text.slice(index + quote.length);
  const start = Math.max(before.lastIndexOf('。'), before.lastIndexOf('\n'), before.lastIndexOf('！'), before.lastIndexOf('？')) + 1;
  const end = after.search(/[。\n！？]/);
  return source.text.slice(start, end < 0 ? source.text.length : index + quote.length + end).trim();
}
export function statementNature(context: string, sourceId = ''): Statement['kind'] | null {
  if (sourceId === 'market' || goal.test(context)) return 'goal';
  if (unknown.test(context) || conditional.test(context)) return 'unknown';
  if (negative.test(context)) return 'limitation';
  return null;
}
export function checkStatements(statements: Statement[], sources: AnalysisSource[]) {
  const accepted: CheckedStatement[] = [], rejected: EvidenceIssue[] = [], ids = new Set<string>();
  for (const item of statements) {
    const source = sources.find(s => s.id === item.sourceId);
    const context = source ? sourceContext(source, item.quote) : '';
    let reason = '';
    if (ids.has(item.id)) reason = '事实编号重复';
    ids.add(item.id);
    if (!source || !context) reason = '原始资料中不存在引用';
    else if (context.length > 2000) reason = '引用上下文过长，需要保留完整条件后重新提取';
    else if (item.product && !context.includes(item.product)) reason = '产品范围没有对应原文';
    else if (item.region && !scopeText(context).includes(scopeText(item.region))) reason = '地区范围没有对应原文';
    const nature = statementNature(context, item.sourceId);
    // A sentence may assert a service and separately deny another offering.
    // Keep the full context on display; only accept an affirmative clause actually selected by the quote.
    const independentPositive = ['business','ability','limitation'].includes(item.kind) && item.sourceId !== 'market' &&
      !goal.test(context) && !conditional.test(context) && context.split(/[，,；;。\n]/).some(clause =>
        clause.trim() && item.quote.includes(clause.trim()) &&
        (item.kind==='limitation' ? statementNature(clause)==='limitation' : !statementNature(clause)));
    if (!reason && nature && nature !== item.kind && !independentPositive) reason = `原文属于${nature}，不能当作${item.kind}`;
    if (!reason && item.kind === 'ability' && (item.period !== 'current' || historical.test(context))) reason = '非当前能力，不进入现有能力列表';
    if (reason) {rejected.push({id: item.id, reason}); continue;}
    accepted.push({...item, context, provenance: source!.kind === 'website' ? '官网陈述' : '企业提供'});
  }
  return {accepted, rejected};
}

// Facts shown to users retain source wording. Free paraphrases cannot promote a goal into an ability.
export function factualProjection(items: CheckedStatement[]) {
  const lines = (kind: Statement['kind']) => [...new Set(items.filter(s => s.kind === kind).map(s => {
    const clauses=s.context.split(/[，,；;。\n]/).map(c=>c.trim()).filter(Boolean);
    const mixed=new Set(clauses.map(c=>statementNature(c))).size>1;
    const selected=clauses.filter(c=>s.quote.includes(c) &&
      (['business','ability'].includes(kind) ? !statementNature(c) : statementNature(c)===kind));
    return (mixed && kind!=='goal' && selected.length ? selected.join('，') : s.context).slice(0,790);
  }))];
  return {
    summary: (lines('business').join('；') || '企业业务仍需核实，请查看原始资料。').slice(0, 800),
    businessModel: '合作方式由企业资料及下方客户假设说明；尚未外部核实。',
    capabilities: lines('ability').slice(0, 20),
    limitations: [...lines('limitation'), ...lines('unknown')].slice(0, 20),
    goals: lines('goal'),
  };
}
