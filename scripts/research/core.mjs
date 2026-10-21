import { createHash } from 'node:crypto';
import { id, httpUrl } from './schema.mjs';
import {findCompany} from './company-identity.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
const normal = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function host(value) {
  return new URL(httpUrl(value)).hostname.toLowerCase().replace(/^www\./, '');
}
export function upsertCompany(data, item) {
  if (!item.name?.trim() || !item.country?.trim()) throw new Error('公司名称和国家不能为空');
  const domain = item.website ? host(item.website) : '';
  const same = findCompany(data.companies,item);
  if (same) {
    for (const k of ['product','buyerType','source']) if (!same[k] && item[k]) same[k] = item[k];
    return { company: same, added: false };
  }
  const company = { id: id('C'), name: item.name.trim(), country: item.country.trim(), city: item.city || '', website: item.website ? httpUrl(item.website) : '', product: item.product || '', buyerType: item.buyerType || '', status: '待研究', source: item.source || '', updatedAt: new Date().toISOString() };
  data.companies.push(company);
  return { company, added: true };
}
