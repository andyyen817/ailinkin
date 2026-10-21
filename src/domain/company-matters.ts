import {z} from 'zod';
import type {CompanyAnalysisInput, AnalysisSource} from './company-analysis';
import {normalText, statementNature} from './company-evidence';
import {targetMarkets,marketKey,mentionedMarkets} from './target-markets';

const topics: Record<string, RegExp> = {
  installation: /安装|\binstall(?:ation)?\b/i,
  training: /培训|\btraining\b/i,
  maintenance: /维修|维护|售后|\b(maintenance|repair|after.?sales)\b/i,
  local_team: /当地.{0,6}团队|本地.{0,6}团队|local.{0,15}team/i,
  delivery: /供货|交付|发货|出口|\b(deliver|delivery|supply|shipping|export)\b/i,
  certification: /认证|资质|证书|\b(certification|certificate|accreditation)\b/i,
  capacity: /产能|月产|起订|批量|\b(capacity|moq|batch)\b/i,
  product_form: /产品.{0,8}形态|原料|零件|成品|\b(product form|raw material|component|finished product)\b/i,
};
export function matterTopics(value: string): string[] {
  let clean = value.replace(/安装培训/g, '培训').replace(/installation training/gi, 'training');
  if (topics.local_team.test(clean)) clean = clean.replace(/(当地|本地).{0,8}团队|local.{0,20}team/gi, 'local team');
  return Object.entries(topics).filter(([name,re]) => re.test(name === 'local_team' ? value : clean)).map(([name]) => name);
}
const regionKey = (v: string) => targetMarkets(v).map(marketKey).map(k=>k==='sweden'?'瑞典':k==='china'?'中国':normalText(k)).sort().join(',');
function regionOf(value: string, market: string) {
  if (/国内|domestic/i.test(value)) return 'domestic';
  if (/海外|国外|overseas|abroad/i.test(value)) return 'overseas';
  if (/全球|worldwide|all countries/i.test(value)) return 'global';
  if (/瑞典|sweden|sverige/i.test(value)) return '瑞典';
  const named=mentionedMarkets(value,market);if(named.length)return regionKey(named.join(','));
  return market && normalText(value).includes(normalText(market)) ? regionKey(market) : '';
}
export type Matter = {key: string; topic: string; product: string; region: string;
  status: 'yes' | 'no' | 'unknown' | 'conflict'; sourceIds: string[]; quotes: string[]};
export const questionDraftSchema = z.object({
  id:z.string().min(1).max(100), text:z.string().min(1).max(800), reason:z.string().min(1).max(800),
  topic:z.string().min(1).max(100), product:z.string().max(200), region:z.string().max(200),
}).strict();
export type QuestionDraft = z.infer<typeof questionDraftSchema>;
export const matterKey = (topic: string, product: string, region: string) => [normalText(topic),normalText(product),regionKey(region)].join('|');
const keyFor = matterKey;
function answerState(value: string): Matter['status'] {
  const nature = statementNature(value);
  if (nature === 'unknown' || nature === 'goal' || /不清楚|暂不确定/i.test(value)) return 'unknown';
  if (nature === 'limitation' || /^(不|否)$|^no\b/i.test(value)) return 'no';
  return 'yes';
}
export function knownMatters(input: CompanyAnalysisInput, sources: AnalysisSource[], contexts:QuestionDraft[]=[]) {
  const memory = new Map<string, Matter>();
  const add = (topic:string,region:string,text:string,sourceId:string,product='') => {
    const key=keyFor(topic,product,region), previous=memory.get(key), status=answerState(text);
    // Product inventory and capacity ranges can contain complementary positive/negative limits.
    const descriptive = ['product_form','capacity'].includes(topic);
    const conflict = previous && previous.status !== status && !descriptive;
    const combined = descriptive && previous && (previous.status==='yes' || status==='yes') ? 'yes' : status;
    memory.set(key,{key,topic,product,region,status:conflict?'conflict':combined,
      sourceIds:[...new Set([...(previous?.sourceIds || []),sourceId])],quotes:[...(previous?.quotes || []),text]});
  };
  for (const source of sources.filter(s => !['market','intent'].includes(s.id))) {
    const answer = source.id.startsWith('answer-') ? input.answers[Number(source.id.slice(7))] : null;
    const question=answer?contexts.find(q=>q.id===answer.questionId && normalText(q.text)===normalText(answer.question)):null;
    let inheritedRegion='';
    for (const clause of source.text.split(/[。；;，,\n]/).filter(Boolean)) {
      if(!answer && statementNature(clause,source.id)==='goal') continue;
      const region=regionOf(clause,input.market) || (/当地|本地/.test(clause)?inheritedRegion:'') || (answer?regionOf(answer.question,input.market):'');
      if(region) inheritedRegion=region;
      let found=matterTopics(clause);
      if(!found.length && answer) found=matterTopics(answer.question);
      if(!found.length && question) found=[question.topic];
      for(const topic of found) add(topic,region || question?.region || '',clause,source.id,question?.product || '');
    }
  }
  return [...memory.values()];
}
export function filterQuestions(questions: QuestionDraft[], memory: Matter[], input: CompanyAnalysisInput,
  pending: QuestionDraft[] = []) {
  const allowed: QuestionDraft[]=[], rejected: {id:string;reason:string}[]=[], seen=new Set<string>();
  for(const q of questions) {
    const recognized=matterTopics(q.text), inferredRegion=regionOf(q.text,input.market);
    const key=keyFor(q.topic,q.product,q.region), settled=memory.filter(m=>m.topic===q.topic && m.product===q.product &&
      (m.region===regionKey(q.region) || m.region==='global'));
    let reason='';
    if (/想找.{0,10}客户|优先.{0,8}渠道|选择.{0,8}买家|目标客户.{0,12}(主要|还是|侧重)|要求.{0,12}(合作伙伴|买方|客户).{0,20}(具备|承担)|希望.{0,8}(何种|哪种|哪类).{0,24}(合作|进入|伙伴)|which customers|what type of buyers/i.test(q.text) ||
      /(合作伙伴|客户|买方).{0,12}(是否|有无|需要|要求).{0,20}(资质|认证|要求|具备)/.test(q.text)) reason='客户方向及买方条件应由系统推导';
    else if(recognized.length ? !recognized.includes(q.topic) : !normalText(q.text).includes(normalText(q.topic))) reason='问题事项与问法不一致';
    else if(regionKey(q.region)!==inferredRegion) reason='问题地区范围与问法不一致';
    else if(q.product && !q.text.includes(q.product)) reason='问题产品范围不明确';
    else if(settled.some(m=>m.status!=='conflict')) reason='该事项已有明确回答或已记录未知';
    else if(settled.some(m=>m.status==='conflict') && !/矛盾|冲突|之前|此前|不一致|conflict|previous/i.test(q.text)) reason='应明确指出资料冲突';
    else if(input.answers.some(a=>a.questionId===q.id || normalText(a.question)===normalText(q.text))) reason='已经回答的问题';
    else if(seen.has(key)) reason='本轮相同事项重复';
    if(reason) rejected.push({id:q.id,reason});
    else {seen.add(key);allowed.push(pending.find(p=>keyFor(p.topic,p.product,p.region)===key) || q);}
  }
  return {allowed:allowed.slice(0,3),rejected};
}
