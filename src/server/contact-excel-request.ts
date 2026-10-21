import 'server-only';
import {z} from 'zod';
import type {Campaign} from '@/domain/research';
import {AccessError} from './policy';
import {contactExcelView} from './contact-excel-view';
import {contactReviewXlsx} from './contact-review-xlsx';

export function contactExcelFilter(url:URL){
  return z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/).optional().parse(url.searchParams.get('companyId')??undefined);
}
export function prepareContactExcel(row:Campaign,companyId?:string){
  try{return contactExcelView(row,companyId);}catch(error){
    if((error as Error).message==='CONTACT_EXCEL_COMPANY_NOT_FOUND')throw new AccessError('CONTACT_EXCEL_COMPANY_NOT_FOUND',404);
    if((error as Error).message==='CONTACT_EXCEL_TOO_LARGE')throw new AccessError('CONTACT_EXCEL_TOO_LARGE',413);
    throw error;
  }
}
export async function contactExcelResponse(view:ReturnType<typeof contactExcelView>){
  const bytes=await contactReviewXlsx(view),filename=`${view.market.slice(0,60)}_联系人销售表.xlsx`;
  return new Response(new Uint8Array(bytes),{headers:{
    'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition':`attachment; filename="contact-sales.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
  }});
}
