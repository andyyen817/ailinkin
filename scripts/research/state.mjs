import { id, platforms, completed, statuses, httpUrl } from './schema.mjs';
import {platformCatalog,platformsFor} from './platform-catalog.mjs';

export function latest(data, companyId, platform) {
  const entries = data.attempts.filter(a => a.companyId === companyId && a.platform === platform && a.current);
  if (entries.length > 1) throw new Error('同一平台存在多个当前任务，需核对');
  return entries[0];
}
export function needsWork(a, now = Date.now(), scope = 'v1') {
  if (!a) return true;
  if (a.scope !== scope && a.status !== '检索中') return true;
  if (completed.has(a.status)) return !Number.isFinite(Date.parse(a.expiresAt)) || Date.parse(a.expiresAt) <= now;
  if (['访问受限／未接入','待核实','已跳过','检索中'].includes(a.status)) return false;
  if (a.retries >= 5) return false;
  return !a.retryAt || Date.parse(a.retryAt) <= now;
}
export function beginAttempt(data, companyId, platform, query, scope = 'v1', now = Date.now()) {
  if (!platformCatalog[platform] || !data.companies.some(c => c.id === companyId)) throw new Error('客户或平台无效');
  const previous = latest(data, companyId, platform);
  if (!needsWork(previous, now, scope)) return null;
  if (!String(query).trim()) throw new Error('查询范围不能为空');
  if (previous) previous.current = false;
  const a = { id: previous?.id || id('T'), companyId, platform, attemptId: id('A'), stage: '账号查找', status: '检索中', query, scope, current: true, retries: previous?.retries || 0, checkedAt: new Date(now).toISOString() };
  data.attempts.push(a);
  return a;
}
export function finishAttempt(a, result, now = Date.now()) {
  if (a.status !== '检索中' || !a.current) throw new Error('只有当前执行中的任务可结束');
  if (!statuses.includes(result.status) || ['未开始','检索中'].includes(result.status)) throw new Error('结束状态无效');
  if (completed.has(result.status)) {
    if (!result.queryFinished) throw new Error('查询尚未完成，不能勾选');
    if (!Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= now) throw new Error('需要有效的刷新期限');
  }
  if (result.status === '已完成—有资料') {
    if (!result.identity || !result.summary || !result.evidence?.length) throw new Error('缺少身份或事实证据');
    httpUrl(result.url);
    for (const e of result.evidence) { httpUrl(e.url); if (!e.quote?.trim()) throw new Error('证据摘录为空'); }
  }
  const { status, url, identity, summary, evidence, error, retryAt, expiresAt, stage,readScope } = result;
  Object.assign(a, { status, url, identity, summary, evidence, error, retryAt, expiresAt,readScope, stage: stage || '内容研究', checkedAt: new Date(now).toISOString() });
  if (status === '待重试') a.retries++;
  return a;
}
export function pending(data, now = Date.now()) {
  return data.companies.filter(c => c.status !== '已排除').flatMap(c => platformsFor(data.project).filter(p => needsWork(latest(data, c.id, p), now)).map(p => ({ companyId: c.id, platform: p })));
}
export function recoverInterrupted(data) {
  if (data.requests.some(r => r.status === 'pending' || r.status === 'unknown')) throw new Error('外部请求结果未知，先核对供应商记录，不能自动重放');
  for (const a of data.attempts.filter(a => a.current && a.status === '检索中')) {
    finishAttempt(a, { status: '待重试', error: '进程中断，保留历史后续跑', retryAt: new Date().toISOString() });
  }
}
