import {z} from 'zod';
import {legacyPlatforms} from '../../scripts/research/platform-catalog.mjs';
export const searchInput=z.preprocess((raw)=>{
  if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&(raw as any).discoveryMode==='coverage')return {...raw,target:10000};
  return raw;
},z.object({
  analysis:z.object({id:z.uuid(),profileId:z.string().min(1).max(800),version:z.number().int().min(1),market:z.string().trim().min(1).max(100).optional(),relatedCampaignIds:z.array(z.uuid()).max(100).optional()}).strict().optional(),
  discoveryProvider:z.enum(['web','apollo']).default('web'),maxApolloCredits:z.number().int().min(1).max(5).default(1),
  product:z.string().trim().min(1).max(200),country:z.string().trim().min(1).max(100),city:z.string().trim().max(100).default(''),
  target:z.number().int().min(1).max(10000),keywords:z.array(z.string().trim().min(1).max(200)).max(200).default([]),
  discoveryMode:z.literal('coverage').optional(),expectedTarget:z.number().int().min(1).max(10000).optional(),
  maxRequests:z.number().int().min(0).max(10000).default(0),maxSpendUsd:z.number().min(0).max(10000).default(0),
}).strict());
export type SearchInput=z.infer<typeof searchInput>;
export function searchTerms(input:Omit<SearchInput,'discoveryProvider'|'maxApolloCredits'> & Partial<Pick<SearchInput,'discoveryProvider'|'maxApolloCredits'>>){
  if(input.keywords.length)return [...new Set(input.keywords)];
  if(input.discoveryProvider==='apollo')return /黄铜|brass|mässing/i.test(input.product)?['brass','brass fittings','brass components','brass lighting','brass hardware']:[input.product];
  if(/黄铜|brass|mässing/i.test(input.product)){
    if(/^(中国大陆|大陆|中国|中国内地|Mainland China)$/i.test(input.country)){
      const sectors=['阀门','卫浴','水暖','灯饰','门窗五金','精密零件','电子连接器','汽车配件','锁具','家具五金'];
      const regions=['广东','浙江','江苏','山东','河北','福建','上海','河南','湖北','四川','安徽','江西'];
      return sectors.flatMap(s=>regions.map(r=>`${r} 黄铜 ${s} 有限公司`));
    }
    const products=['brass fittings','brass components','brass hardware','brass lighting','mässingsbeslag','mässingskomponenter','mässing inredning','mässing grossist'];
    const buyers=['wholesaler','distributor','brand','manufacturer'];
    return products.flatMap(p=>buyers.map(b=>p+' '+b));
  }
  return ['importer','wholesaler','distributor','manufacturer','brand','retailer'].map(b=>input.product+' '+b);
}
export const platformNames=[...legacyPlatforms];
export type Campaign={id:string;tenant_id:string;version:number;state:string;message:string;data:any;lease_token:string|null;lease_until:Date|null};
