import {host,upsertCompany} from './core.mjs';
const places='北京 天津 上海 重庆 河北 山西 辽宁 吉林 黑龙江 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 海南 四川 贵州 云南 陕西 甘肃 青海 内蒙古 广西 宁夏 新疆 西藏 深圳 广州 东莞 佛山 中山 珠海 惠州 江门 肇庆 汕头 韶关 揭阳 潮州 清远 宁波 温州 台州 玉环 绍兴 杭州 嘉兴 湖州 金华 永康 义乌 诸暨 慈溪 余姚 乐清 瑞安 苏州 无锡 常州 南京 镇江 扬州 南通 泰州 盐城 昆山 常熟 张家港 青岛 济南 烟台 潍坊 临沂 淄博 济宁 聊城 德州 泰安 郑州 洛阳 新乡 安阳 焦作 开封 武汉 襄阳 长沙 株洲 衡阳 成都 绵阳 德阳 西安 宝鸡 汉中 厦门 泉州 漳州 福州 南平 南昌 赣州 鹰潭 新余 九江 合肥 芜湖 铜陵 马鞍山 宣城 滁州 安庆 蚌埠 黄山 沧州 保定 廊坊 邢台 邯郸 石家庄 唐山 衡水 沈阳 大连 丹东 鞍山 抚顺 长春 哈尔滨 南宁 柳州 桂林 贵阳 昆明 兰州 银川 太原 运城 晋城 阳泉'.split(' ');
const directories=/\b(industrystock|zyzhan|jc35|huajx|gongchang|gkzhan|chem17|hbzhan|nongjx|foodjx|86pla|aoshuo|czvv|cntrades|chinasup|cn5135|99114|1688|11467|huangye88|b2b168|hc360|china|made-in-china|coowor|cens|diytrade|qcc|tianyancha|qixin|51sole|jdzj|tradesns|globalimporter|cnpowder|alu|gys|youboy)\.(com|cn|net)/i;
const nonCompany=/\b(baidu|zhihu|docin|doc88|douban|wikipedia|sohu|163|qq|sina|toutiao|thepaper|bilibili|youtube|amazon)\.(com|cn|org)/i;
const companyPattern=/[\p{Script=Han}A-Za-z0-9（）()·＆&]{4,50}?(?:股份有限公司|有限责任公司|有限公司|五金厂|阀门厂|机械厂|铸造厂|加工厂|制造厂|金属厂|铜材厂|灯饰厂|经营部|商行)/gu;
export const isMainland=project=>/^(中国大陆|大陆|中国|中国内地|Mainland China)$/i.test(project.country)&&/黄铜|brass/i.test(project.product);
const norm=s=>s.replace(/[\s（）()]/g,'').toLowerCase();
const names=text=>[...new Set((String(text||'').match(companyPattern)||[]).map(n=>n.replace(/^(?:欢迎来到|欢迎进入|欢迎访问|供货厂家|公司基本资料信息|联系我们|关于我们|首页|关于|联系|走进|探访|参观|介绍|网址|官网|公司简介)+/,'')))];
const excerpt=(text,word)=>{const index=text.toLowerCase().indexOf(word.toLowerCase());return index<0?'':text.slice(Math.max(0,index-40),index+160);};
export function mainlandCandidate(data,hit,query,provider){
  const reject=reason=>({excluded:true,reason,url:hit.url});
  let domain;try{domain=host(hit.url);}catch{return reject('链接无效');}
  if(nonCompany.test(domain))return reject('资讯、文库或综合内容平台');
  const text=[hit.title,hit.siteName,hit.snippet].filter(Boolean).join(' ');
  const product=text.match(/黄铜|brass/i)?.[0];
  if(!product)return reject('页面未提供黄铜业务依据');
  const siteNames=names(hit.siteName),titleNames=names(hit.title),bodyNames=names(hit.snippet);
  const preferred=siteNames.length===1?siteNames:titleNames.length===1?titleNames:bodyNames;
  if(preferred.length!==1)return reject('没有唯一可识别的企业名称');
  if(/\d+.*制造商.*供应商|公司名录|厂家大全|企业名录/.test(hit.title||''))return reject('多企业目录入口');
  const name=preferred[0];if(/^(淋浴|黄铜|供应|批发|专业)/.test(name))return reject('泛称不能确认为企业名称');
  const place=places.find(p=>name.includes(p))||places.find(p=>text.includes(p));
  if(!place||/香港|台湾|台灣|澳门|澳門/.test(name))return reject('缺少大陆地区依据或非大陆企业');
  const shared=directories.test(domain),pathname=new URL(hit.url).pathname;
  if(shared&&pathname==='/'&&!domain.split('.')[0].match(/\d|-/))return reject('目录首页不能作为单一企业');
  const existing=data.companies.find(c=>norm(c.name)===norm(name));
  const result=existing?{company:existing,added:false}:upsertCompany(data,{name,country:'中国大陆',city:place,website:shared?'':new URL(hit.url).origin,source:hit.url,product:'黄铜相关业务',buyerType:'待核实'});
  const c=result.company;c.discovery ||= [];
  if(!c.discovery.some(e=>e.url===hit.url&&e.query===query))c.discovery.push({provider,query,url:hit.url,title:hit.title,summary:hit.snippet?.slice(0,6000)||'',publishedAt:hit.date,retrievedAt:new Date().toISOString()});
  c.profile ||= {region:place,nameEvidence:name,regionEvidence:excerpt(text,place),productEvidence:excerpt(text,product),sourceType:shared?'企业目录资料页':'企业网站候选',verified:false};
  if(!shared){
    const email=hit.snippet?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||'';
    const phone=hit.snippet?.match(/(?:联系电话|公司电话|电话|Tel)[：:\s]*((?:\+?86[ -]?)?(?:0\d{2,3}[ -]?\d{7,8}|1[3-9]\d{9}))/i)?.[1]||'';
    if((email||phone)&&!data.contacts.some(p=>p.companyId===c.id&&(email?p.email===email:p.phone===phone)))data.contacts.push({id:c.id+'-'+data.contacts.length,companyId:c.id,name:'公开业务联系方式',title:'归属待核实',email,phone,emailStatus:'搜索摘要提取，未验证',source:hit.url,suppressed:false});
  }
  if(result.added)c.status='待核实';
  return result;
}

export function reconcileMainland(data){
  if(!isMainland(data.project)||data.project.discoveryParserVersion===2)return;
  if(data.attempts.length||data.companies.some(c=>c.analysis))return;
  const view={...data,companies:[],contacts:[]};
  for(const company of data.companies)for(const e of company.discovery||[]){
    mainlandCandidate(view,{url:e.url,title:e.title,siteName:company.name,snippet:e.summary,date:e.publishedAt},e.query,e.provider);
  }
  data.discoveryCorrections ||= [];
  data.discoveryCorrections.push({at:new Date().toISOString(),before:data.companies.length,after:view.companies.length,reason:'剔除多企业目录和泛称，修正名称前缀及目录网址归类'});
  data.companies=view.companies;data.contacts=view.contacts;data.project.discoveryParserVersion=2;
}
