import { randomUUID } from 'node:crypto';
import {legacyPlatforms,platformCatalog} from './platform-catalog.mjs';
export {platformsFor} from './platform-catalog.mjs';

export const platforms = [...legacyPlatforms];
export const statuses = ['未开始', '检索中', '已完成—有资料', '已完成—未发现', '待核实', '待重试', '访问受限／未接入', '待刷新', '已跳过'];
export const completed = new Set(statuses.slice(2, 4));
export const domains = Object.fromEntries(Object.entries(platformCatalog).filter(([,v])=>v.canonical).map(([k,v])=>[k,v.canonical]));
export const headers = {
  客户总表: ['客户ID', '公司名称', '国家', '城市', '官网', '主营产品', '买家类型', '初筛状态', ...platforms.flatMap(p => [p+'完成', p+'状态', p+'链接']), '完成数', '联系人', '邮箱', '电话', '匹配理由', '合作假设', '信件草稿', '来源', '更新时间'],
  研究记录: ['任务ID', '客户ID', '平台', '尝试ID', '阶段', '状态', '查询', '账号链接', '身份依据', '资料摘要', '证据链接', '发布时间', '检索时间', '下次重试', '有效期至', '失败原因', '重试次数', '当前记录', '范围版本'],
  联系人: ['联系人ID', '客户ID', '姓名', '职位', '当前公司依据', '邮箱', '邮箱来源', '邮箱核验状态', '核验时间', '电话', '号码类型', '电话来源', 'Apollo引用', '补全时间', '禁止联系'],
  搜索批次: ['查询ID', '批次ID', '国家', '城市', '买家类型', '关键词', '语言', '来源', '页码游标', '开始时间', '结束时间', '返回数', '新增数', '重复数', '状态', '异常', '下次刷新', '估算费用USD'],
};
export function headersFor(names=platforms){return {...headers,客户总表:[...headers.客户总表.slice(0,8),...names.flatMap(p=>[p+'完成',p+'状态',p+'链接']),...headers.客户总表.slice(8+platforms.length*3)]};}
export const id = prefix => prefix+'-'+randomUUID();
export function emptyLedger(project = {}) {
  return { version: 1, revision: 0, project: { tenantId: id('tenant'), product: '', country: '', city: '', keywords: [], target: null, maxRequests: 0, maxSpendUsd: 0, ...project }, companies: [], attempts: [], contacts: [], batches: [], requests: [] };
}
export function assertProject(project) {
  for (const key of ['tenantId', 'product', 'country']) if (!String(project[key] || '').trim()) throw new Error('缺少资料：'+key);
  if (!Number.isInteger(project.target) || project.target < 1 || project.target > 10000) throw new Error('客户数量须为 1–10000 的整数');
  if (!project.keywords?.length) throw new Error('请填写客户类型与搜索关键词');
}
export function text(value) {
  const s = String(value ?? '').slice(0, 32000);
  return /^[\s]*[=+@-]/.test(s) ? "'"+s : s;
}
export function httpUrl(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('只允许公开 HTTP(S) 链接');
  return u.href;
}
