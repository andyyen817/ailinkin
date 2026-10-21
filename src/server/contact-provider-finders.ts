import 'server-only';

export const finderEndpoints: Record<string, string> = {
  hunter: '/v2/email-finder', dropcontact: '/v1/enrich/all', prospeo: '/enrich-person',
};
const hosts: Record<string, string> = {
  hunter: 'https://api.hunter.io', dropcontact: 'https://api.dropcontact.com', prospeo: 'https://api.prospeo.io',
};
export function companyDomain(value: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host) ? host : '';
  } catch { return ''; }
}
export async function finderRequest(provider: string, person: any, key: string,
  fetcher: typeof fetch = fetch, receipt: (value: any) => Promise<void> = async () => {},
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)), pendingRequestId?: string) {
  const domain = companyDomain(person.domain || ''), endpoint = finderEndpoints[provider];
  if (!key || !endpoint || !domain || !person.name?.trim()) throw Error('FINDER_INPUT_OR_CREDENTIAL_UNAVAILABLE');
  const send = async (route: string, body?: any) => {
    const url = new URL(route, hosts[provider]);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider === 'hunter') {
      url.searchParams.set('api_key', key); url.searchParams.set('domain', domain);
      url.searchParams.set('full_name', person.name); url.searchParams.set('max_duration', '20');
    } else headers[provider === 'prospeo' ? 'X-KEY' : 'X-Access-Token'] = key;
    await receipt({ stage: 'send_started', route, method: body ? 'POST' : 'GET' });
    let response: Response;
    try { response = await fetcher(url, { method: body ? 'POST' : 'GET', headers,
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
    } catch { throw Error('FINDER_NETWORK_RESULT_UNKNOWN'); }
    const text = await response.text();
    const rateHeaders=Object.fromEntries(['retry-after','x-daily-request-left','x-minute-request-left','x-daily-reset-seconds','x-minute-reset-seconds','x-daily-rate-limit','x-minute-rate-limit','x-second-rate-limit'].map(k=>[k,response.headers.get(k)]).filter(([,v])=>v!==null));
    await receipt({ stage: 'body_received', route, httpStatus: response.status, rawResponse: text,rateHeaders });
    if (text.length > 4000000) throw Error('FINDER_RESPONSE_TOO_LARGE');
    let raw: any; try { raw = JSON.parse(text); } catch { throw Error('FINDER_RESPONSE_NOT_JSON'); }
    if (provider === 'prospeo' && raw.error_code === 'NO_MATCH') return { ...raw, httpStatus: response.status };
    if (!response.ok || raw.error === true) throw Object.assign(Error('FINDER_HTTP_' + response.status + ':' + String(raw.error_code || '')),
      { status: response.status >= 500 ? '待核实' : response.status });
    return { ...raw, httpStatus: response.status };
  };
  if (provider === 'hunter') return send(endpoint);
  if (provider === 'prospeo') return send(endpoint, { only_verified_email: true, enrich_mobile: false,
    data: { full_name: person.name, company_website: domain, company_name: person.companyName,
      ...(person.prospeoId?{person_id:person.prospeoId}:{}),...(person.prospeoId&&person.profileUrl?{linkedin_url:person.profileUrl}:{}) } });
  let raw = pendingRequestId ? {request_id:pendingRequestId} : await send(endpoint, { data: [{ full_name: person.name, company: person.companyName, website: domain }], language: 'en' });
  if (!raw.request_id) return raw;
  const requestId = String(raw.request_id);
  if (!/^[a-zA-Z0-9_-]{1,150}$/.test(requestId)) throw Error('FINDER_REQUEST_ID_INVALID');
  await receipt({ stage: 'async_accepted', providerRequestId: requestId });
  for (let poll = 0; poll < 3; poll++) {
    if (poll) await sleep(30000);
    raw = await send(endpoint + '/' + requestId);
    if (raw.success && Array.isArray(raw.data)) return { ...raw, providerRequestId: requestId };
    if (raw.error) break;
  }
  return { ...raw, providerRequestId: requestId, providerPending: true };
}
export function normalizeFinder(provider: string, person: any, raw: any, now = new Date().toISOString()) {
  const empty = { provider, people: [] as any[], channels: [] as any[], observation: raw };
  if (raw.providerPending) return { ...empty, state: 'provider_pending', requestId: raw.providerRequestId,
    notice: '供应商仍在处理，原请求编号已保存；不重新提交补全。' };
  const data = provider === 'hunter' ? raw.data : provider === 'prospeo' ? raw.person : raw.data?.[0];
  const requestedDomain = companyDomain(person.domain || '');
  if (!data) return { ...empty, state: 'not_found', notice: '本来源未取得邮箱，原始结果已保存。' };
  const returnedName = data.full_name || [data.first_name, data.last_name].filter(Boolean).join(' ');
  const normal = (s: string) => String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const nameMatch = !returnedName || normal(returnedName) === normal(person.name);
  const profile=(v:string)=>String(v||'').replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'').toLowerCase();
  const exactIdentity=provider==='prospeo'&&!!person.prospeoId&&data.person_id===person.prospeoId&&
    (!person.profileUrl||profile(data.linkedin_url)===profile(person.profileUrl));
  if(provider==='prospeo'&&person.prospeoId&&!exactIdentity)return {...empty,state:'identity_ambiguous',notice:'人员ID或个人主页与已保存资料不一致，未绑定邮箱。'};
  const returnedDomain = companyDomain(provider === 'prospeo' ? raw.company?.website || raw.company?.domain || '' : data.website || data.domain || '');
  const sourceUrl = provider === 'hunter' ? hosts.hunter + finderEndpoints.hunter : hosts[provider] + finderEndpoints[provider];
  const values: any[] = provider === 'dropcontact' ? data.email || [] : [{ email: provider === 'prospeo' ? data.email?.email : data.email }];
  if(provider==='prospeo'&&data.email?.revealed!==true)return {...empty,state:'not_found',notice:'供应商未揭示完整邮箱，未作为联系方式保存。'};
  for (const value of values) {
    const email = String(value.email || '').trim().toLowerCase();
    if (!/^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(email)) continue;
    const companyDomains=provider==='prospeo'?[raw.company?.website,raw.company?.domain,...(raw.company?.other_websites||[])].map(v=>companyDomain(v||'')):[];
    const returnedEmailDomain=companyDomain(raw.company?.email_tech?.domain||'');
    const domainMatch = email.split('@')[1] === requestedDomain && (!returnedDomain || returnedDomain === requestedDomain)||
      exactIdentity&&companyDomains.includes(requestedDomain)&&!!returnedEmailDomain&&email.split('@')[1]===returnedEmailDomain;
    const generic = /^(info|hello|contact|support|sales|admin|office|service|careers|hr)@/i.test(email) || /generic/.test(value.qualification || '');
    const evidence = [{ sourceUrl, sourceType: 'provider_receipt', retrievedAt: now,
      quote: JSON.stringify({ provider, requestedName: person.name, requestedCompany: person.companyName,
        requestedDomain, returnedName: returnedName || null, returnedDomain: returnedDomain || null, email,exactIdentity,
        ...(provider==='prospeo'?{personId:data.person_id,profileUrl:data.linkedin_url,emailDomain:returnedEmailDomain}:{}),
        sourceType: data.source_type || 'provider_match', providerEmailStatus: data.email?.status || value.qualification || data.verification?.status || null }) }];
    const contact = { kind: 'email', value: email, scope: generic ? 'company' : nameMatch && domainMatch ? 'person' : 'unknown',
      ownership: generic ? 'company_public' : 'provider_candidate', verification: 'unverified',
      provenance: provider === 'hunter' && data.source_type === 'found' ? 'published' : 'provider_match',
      channelEmployer: provider==='prospeo'?raw.company?.name||person.companyName:person.companyName, evidence };
    if (contact.scope === 'person') empty.people.push({ name: person.name,profileUrl:exactIdentity?data.linkedin_url:undefined,sourcePersonId:exactIdentity?'prospeo:'+data.person_id:undefined, relationship: 'unknown', employerVerified: false,
      contacts: [contact], evidence, detailUnknowns: ['供应商邮箱候选；任职、人物归属和邮箱技术有效性分别核实。'] });
    else empty.channels.push(contact);
  }
  return { ...empty, state: empty.people.length ? 'provider_candidate' : empty.channels.length ? 'identity_ambiguous' : 'not_found',
    notice: '供应商返回已保存；公司公共邮箱、姓名或域名有疑点的邮箱不自动绑定人物。' };
}
