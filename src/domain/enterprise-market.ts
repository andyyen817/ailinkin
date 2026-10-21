import {targetMarkets} from './target-markets';
import type {CompanyAnalysisInput} from './company-analysis';
export function enterpriseMarketReady(input:CompanyAnalysisInput){return targetMarkets(input.market).length>0;}
export function enterpriseMarketNotice(input:CompanyAnalysisInput){return enterpriseMarketReady(input)?null:'企业资料已保存。请先选择目标国家或地区，再分析该市场的客户和渠道。';}
