const normal=(s:string)=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const aliases:Record<string,string>={
  '中国':'china','中国大陆':'china','大陆':'china','中国内地':'china','mainland china':'china',
  '瑞典':'sweden','sverige':'sweden','印尼':'indonesia','印度尼西亚':'indonesia','id':'indonesia',
  '菲律宾':'philippines','ph':'philippines','美国':'united states','德国':'germany','英国':'united kingdom',
};
export function marketKey(value:string){const key=normal(value);return aliases[key]||key;}
// Explicit list delimiters preserve unknown place names without guessing countries.
export function targetMarkets(value:string){
  const unique=new Map<string,string>();
  for(const part of value.split(/[、,，;；|\n]+/).map(s=>s.trim()).filter(Boolean)){
    if(!unique.has(marketKey(part)))unique.set(marketKey(part),part);
  }
  return [...unique.values()];
}
export function queryMarketAllowed(query:string,target:string){
  return targetMarkets(query).length===1&&targetMarkets(target).some(s=>marketKey(s)===marketKey(query));
}
export function mentionedMarkets(text:string,targets:string){
  const value=normal(text),words=' '+value.replace(/[^a-z0-9]+/g,' ')+' ';
  return targetMarkets(targets).filter(target=>{
    const key=marketKey(target),names=[target,key,...Object.keys(aliases).filter(a=>aliases[a]===key&&a.length>2)];
    return names.some(name=>/[a-z]/i.test(name)?words.includes(' '+normal(name).replace(/[^a-z0-9]+/g,' ')+' '):value.includes(normal(name)));
  }).map(marketKey);
}
