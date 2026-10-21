import {z} from 'zod';
const line=z.string().trim().max(500);
const text=z.string().trim().max(5000);
const list=z.array(z.string().trim().min(1).max(150)).max(40);
const website=z.union([z.literal(''),z.url().refine(v=>/^https?:\/\//.test(v),'仅接受 HTTP 或 HTTPS 链接')]);
export const companySchema=z.object({name:line.min(1),website,brand:line,business:text,contact:text,address:text,serviceRegions:list,prohibitedClaims:list,competitors:list,excludedCustomers:list}).strict();
export const productSchema=z.object({name:line.min(1),category:line,applications:list,industries:list,buyerRoles:list,advantages:text,certifications:text,specifications:text,moq:line,leadTime:line,serviceRegions:list,references:text}).strict();
export const factSchema=z.object({claim:text.min(1),source:text,status:z.enum(['pending','confirmed','expired'])}).strict().refine(v=>v.status!=='confirmed'||v.source.length>0,{path:['source'],message:'确认事实必须填写依据来源'});
export const icpSchema=z.object({name:line.min(1),intent:text,template:z.enum(['hvac','industrial','packaging','custom']),keywords:list,applications:list,companyTypes:list,companyCountries:list,contactCountries:list,employeeMin:z.number().int().min(1).max(10000000).nullable(),employeeMax:z.number().int().min(1).max(10000000).nullable(),titles:list,departments:list,seniorities:list,excludeIndustries:list,excludeCompanies:list,excludeTitles:list,excludeExisting:z.boolean(),excludeRejected:z.boolean()}).strict().refine(v=>v.employeeMin===null||v.employeeMax===null||v.employeeMin<=v.employeeMax,{path:['employeeMax'],message:'人数上限必须不小于下限'});
export type CompanyData=z.infer<typeof companySchema>;
export type ProductData=z.infer<typeof productSchema>;
export type FactData=z.infer<typeof factSchema>;
export type ICPData=z.infer<typeof icpSchema>;
export const emptyCompany:CompanyData={name:'',website:'',brand:'',business:'',contact:'',address:'',serviceRegions:[],prohibitedClaims:[],competitors:[],excludedCustomers:[]};
export const emptyProduct:ProductData={name:'',category:'',applications:[],industries:[],buyerRoles:[],advantages:'',certifications:'',specifications:'',moq:'',leadTime:'',serviceRegions:[],references:''};
const common:ICPData={name:'新客户画像',intent:'',template:'custom',keywords:[],applications:[],companyTypes:[],companyCountries:[],contactCountries:[],employeeMin:null,employeeMax:null,titles:[],departments:[],seniorities:[],excludeIndustries:[],excludeCompanies:[],excludeTitles:[],excludeExisting:true,excludeRejected:true};
export const industryTemplates:ReadonlyArray<{key:ICPData['template'];label:string;data:ICPData}>=[
 {key:'hvac',label:'暖通与水暖',data:{...common,name:'暖通与水暖采购客户',template:'hvac',keywords:['HVAC','plumbing','underfloor heating'],applications:['地暖安装','水暖批发'],companyTypes:['distributor','installer'],titles:['Purchasing Manager','Owner'],departments:['Purchasing'],seniorities:['Owner','Manager']}},
 {key:'industrial',label:'工业零部件',data:{...common,name:'工业零部件采购客户',template:'industrial',keywords:['industrial components','manufacturing','system integrator'],applications:['设备制造','设备集成'],companyTypes:['manufacturer','integrator'],titles:['Procurement Manager','Engineering Manager'],departments:['Procurement','Engineering'],seniorities:['Manager','Director']}},
 {key:'packaging',label:'包装材料',data:{...common,name:'包装材料采购客户',template:'packaging',keywords:['packaging materials','packaging distributor','consumer brand'],applications:['品牌包装','包装分销'],companyTypes:['brand','distributor'],titles:['Purchasing Manager','Supply Chain Manager'],departments:['Purchasing','Supply Chain'],seniorities:['Manager','Director']}},
];
// This describes the planned adapter boundary, not an executed Apollo query.
export const postFilterFields=['applications','companyTypes','excludeIndustries','excludeCompanies','excludeTitles','excludeExisting','excludeRejected'] as const;
