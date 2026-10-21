import 'server-only';
import {createHash} from 'node:crypto';
import {transport, publicUrl} from '../../scripts/research/http.mjs';
import {providerConfig} from './research-service';
import {draftGroups} from './company-analysis-model';
import {generateReviewedReport,qualityView,analysisReviewStatus} from './company-reviewed-analysis';
import type {AnalysisRow} from './company-analysis-store';
import {enterpriseMarketNotice} from '@/domain/enterprise-market';

export function companyAnalysisConfig(tenantId: string, env: Record<string, string | undefined> = process.env) {
  let analysisScope:any;try{analysisScope=env.COMPANY_ANALYSIS_SCOPE?JSON.parse(env.COMPANY_ANALYSIS_SCOPE):undefined;}catch{analysisScope=false;}
  if(env.COMPANY_ANALYSIS_SCOPE&&(!analysisScope||typeof analysisScope!=='object'||Array.isArray(analysisScope)))analysisScope=false;
  const config = {...providerConfig(env),live:env.COMPANY_ANALYSIS_ENABLED==='true',analysisScope};
  let limits: any = {}; try { limits = JSON.parse(env.COMPANY_ANALYSIS_LIMITS || '{}')[tenantId] || {}; } catch {}
  const budget = {maxRequests: Number(limits.maxRequests || 0), maxSpendUsd: Number(limits.maxSpendUsd || 0)};
  const missing: string[] = [];
  if (!config.keys.DEEPSEEK_API_KEY || !config.model) missing.push('AI 模型与金钥');
  if (env.COMPANY_ANALYSIS_ENABLED !== 'true') missing.push('管理员启用企业分析');
  if (!config.live) missing.push('真实接口调用设置');
  if(analysisScope===false)missing.push('本轮企业分析范围配置');
  if (!Number.isInteger(budget.maxRequests) || budget.maxRequests < 1 || !Number.isFinite(budget.maxSpendUsd) || budget.maxSpendUsd < 0) missing.push('本企业的 AI 测试额度');
  if (!Number.isFinite(config.costUpperBound.ai) || config.costUpperBound.ai < 0) missing.push('模型单次费用上限');
  return {config, budget, missing};
}
export function analysisInputDigest(input:unknown) {
  return createHash('sha256').update(JSON.stringify(input,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value)).digest('hex');
}
export function presentAnalysis(row: AnalysisRow) {
  const requests = row.data.ledger.requests;
  return {id: row.id, state: row.state, message: row.message, version: row.version, input: row.data.input,
    model: row.data.model, schemaVersion: row.data.schemaVersion, report: row.data.report, groups: row.data.groups,
    previousId:row.data.previousId,hasModelOrigin:row.has_model_origin===true,review:analysisReviewStatus(row.data.report,row.data.input,row.data.sources),
    sources: row.data.sources, createdAt: row.created_at, updatedAt: row.updated_at,
    usage: {requests: requests.filter((r: any) => r.status !== 'blocked_before_send').length,
      reservedUsd: requests.reduce((n: number, r: any) => n + r.reservedCost, 0),
      measuredUsd: null, tokens: requests.filter((r: any) => r.service === 'ai').map((r: any) => r.response?.usage || null)}};
}
export async function executeCompanyAnalysis(row: AnalysisRow,
  save: (state: string, message: string, budget: {maxRequests: number; maxSpendUsd: number}) => Promise<void>,
  options = companyAnalysisConfig(row.tenant_id), fetcher: typeof fetch = fetch) {
  if (row.state === 'complete') return;
  const marketNotice=enterpriseMarketNotice(row.data.input);
  if(marketNotice){await save('blocked',marketNotice,options.budget??{maxRequests:0,maxSpendUsd:0});return;}
  const {config, budget, missing} = options;
  if (missing.length) { await save('blocked', '资料已保存；需要配置：' + missing.join('、'), budget); return; }
  const scope=config.analysisScope;
  const permitted=()=>!scope||(scope.tenantId===row.tenant_id&&scope.inputSha256===analysisInputDigest(row.data.input)&&
    scope.model===config.model&&Date.now()+60000<Date.parse(scope.expiresAt)&&scope.maxRequests===budget.maxRequests&&scope.maxSpendUsd===budget.maxSpendUsd);
  if(!permitted()){await save('blocked','本次资料或时间不在已批准的分析范围内。',budget);return;}
  if (row.data.model !== config.model) { await save('blocked', '模型设置已变化，请保存当前资料建立对应版本。', budget); return; }
  const ledger = row.data.ledger;
  if (ledger.requests.some((r: any) => ['pending', 'unknown'].includes(r.status))) {
    await save('unknown', '前次接口结果未知，暂不重复调用。', budget); return;
  }
  Object.assign(ledger.project, budget);
  const checkpoint = () => save('running', '正在分析企业资料', budget);
  const call = transport(ledger, config, checkpoint, fetcher);
  try {
    if (row.data.input.website && !row.data.sources.some(s => s.kind === 'website')) {
      if (!config.keys.FIRECRAWL_API_KEY || !Number.isFinite(config.costUpperBound.scrape)) {
        if (!row.data.input.business && !row.data.input.documents.length && !row.data.input.offerings?.length) {
          await save('blocked', '官网正文读取尚未配置，请补充业务介绍或资料内容。', budget); return;
        }
      } else {
        const url = await publicUrl(row.data.input.website);
        const raw = await call('scrape', '/v1/scrape', {url, formats: ['markdown'], onlyMainContent: true});
        const content = raw.data?.markdown;
        if (typeof content !== 'string' || !content.trim()) throw Error('WEBSITE_CONTENT_MISSING');
        row.data.sources.push({id: 'website', label: url, text: content.slice(0, 20000), kind: 'website'});
        call.commit(); await checkpoint();
      }
    }
    row.data.report = await generateReviewedReport(row.data.input, row.data.sources, async messages => {
      if(!permitted()||(scope&&Buffer.byteLength(JSON.stringify(messages),'utf8')>100000))throw Error('ANALYSIS_APPROVED_SCOPE_EXCEEDED');
      const raw = await call('ai', '/chat/completions', {model: config.model, messages,
        thinking: {type: 'disabled'}, temperature: 0.2, response_format: {type: 'json_object'}, max_tokens: 8000});
      const choice = raw.choices?.[0];
      if (choice?.finish_reason === 'length') throw Error('ANALYSIS_OUTPUT_TRUNCATED');
      if (choice?.finish_reason !== 'stop') throw Error('ANALYSIS_OUTPUT_INCOMPLETE');
      const content = choice.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw Error('ANALYSIS_EMPTY_RESPONSE');
      return JSON.parse(content);
    },row.data.pendingQuestions || [],row.data.reusedStatements || []);
    row.data.groups = draftGroups(row.data.input, row.data.report);
    call.commit();
    const needsMore = row.data.report.questions.length > 0;
    await save('complete', qualityView(row.data.report).status === 'partial' ? '部分内容未通过检查，已保留有依据的资料；请查看待核实项。' : needsMore ? '已生成分析与待核实问题，请查看并补充关键资料。' : '已生成客户方向建议，请查看依据并生成搜索计划。', budget);
  } catch (error) {
    if ((error as any)?.code === 'ANALYSIS_BUDGET_EXCEEDED') {
      for (const r of ledger.requests.filter((r: any) => r.status === 'pending')) Object.assign(r, {status: 'blocked_before_send', reservedCost: 0});
    }
    const unknown = ledger.requests.some((r: any) => ['pending', 'unknown'].includes(r.status));
    const outputMessage: Record<string, string> = {
      ANALYSIS_OUTPUT_TRUNCATED: 'AI 报告超过本次输出长度，未生成完整报告。资料及用量已保存，请管理员调整模型设置后再试。',
      ANALYSIS_OUTPUT_INCOMPLETE: 'AI 未完整返回报告。资料及接口结果已保存，请管理员检查返回状态后再试。',
      ANALYSIS_EMPTY_RESPONSE: 'AI 返回了空报告。资料及用量已保存，请管理员检查模型设置后再试。',
    };
    await save(unknown ? 'unknown' : 'blocked', unknown ? '接口结果未知，已保留记录；核对前不会重复调用。' :
      (error as any)?.code === 'ANALYSIS_BUDGET_EXCEEDED' ? '本企业的分析额度不足，本次请求未发送。' :
      outputMessage[(error as Error).message] || '分析未通过资料或接口检查，已保存输入和执行记录，请查看配置或补充资料。', budget);
  }
}
