import {marketKey,mentionedMarkets} from './target-markets';
// Unambiguous city/region pairs describe geography, never company identity or purchase intent.
// Unlisted or incomplete addresses stay unknown; a country domain or developer footer is insufficient.
const places:Record<string,Array<[string,string]>>={
 philippines:[['general trias','cavite'],['makati','metro manila'],['quezon city','metro manila']],
 china:[['shenzhen','guangdong'],['guangzhou','guangdong']],
 indonesia:[['surabaya','east java'],['bandung','west java']],
};
export function officeAddressMarket(quote:string,target:string){
 const text=quote.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 if(!/\b(?:main office address|head office address|registered office address|headquarters address)\b/.test(text))return false;
 if(mentionedMarkets(quote,'菲律宾、印尼、中国、瑞典、美国、德国、英国').some(country=>country!==marketKey(target)))return false;
 const words=' '+text+' ';
 return (places[marketKey(target)]||[]).some(pair=>pair.every(place=>words.includes(' '+place+' ')));
}
export function businessLocationQuote(quote:string){
 return quote.replace(/\b(?:web developer|website developed by|website by|web design by)\b[\s\S]*$/i,'');
}
