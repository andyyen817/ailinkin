import 'server-only';
import type {Campaign} from '@/domain/research';
import {companyContactRoutes,responsibleReview} from '../../scripts/research/company-contact-routes.mjs';
import {prepareContactDraft} from '@/domain/contact-drafts';
import {draftDependencyHash} from '@/domain/outreach';
export function prepareContactPackages(row:Campaign,companyIds:string[]){
  if(row.state==='running')throw Error('SEARCH_BUSY_OR_RECOVERY_REQUIRED');
  const group=row.data.project.buyerGroup;
  if(!group?.ready||!group.analysisId)throw Error('CURRENT_COMPANY_ANALYSIS_REQUIRED');
  const prepared=[];
  for(const companyId of [...new Set(companyIds)]){
    const company=row.data.companies.find((c:any)=>c.id===companyId);
    const entity=row.data.sourcePipeline?.entities.find((e:any)=>e.companyId===companyId&&e.ownership?.verified);
    if(!company||!entity||company.qualification?.status!=='qualified')throw Error('QUALIFIED_OFFICIAL_BUYER_REQUIRED');
    const routes=companyContactRoutes(entity),review=responsibleReview(company,row.data.contacts,group);
    const key=draftDependencyHash({composerVersion:2,basis:routes.basisHash,review,analysisVersion:group.analysisVersion,supplier:group.supplier});
    if(company.contactPackage?.dependencyHash!==key){
      const next={...routes,review,draft:prepareContactDraft(entity,group,routes),dependencyHash:key,
        supplierVersion:group.analysisVersion,stage:'联系路径与草稿已保存；尚未发送'};
      if(company.contactPackage)(company.contactPackageHistory||=[]).push(company.contactPackage);
      company.contactPackage=next;
    }
    prepared.push(company.contactPackage);
  }
  return prepared;
}
