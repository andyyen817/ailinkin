import 'server-only';
import ExcelJS from 'exceljs';
import type {ContactExcelSheet,contactExcelView} from './contact-excel-view';
const titles=['个人联系方式与下一步','公司公共及待核渠道','人物及渠道的完整来源','联系渠道与验真','研究覆盖与缺项'];
const tableNames=['SalesContacts','PublicChannels','ContactSources','ChannelVerification','ResearchCoverage'];
function url(value:string){if(/\s/.test(value))return null;try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?value:null;}catch{return null;}}
function displayLines(text:string,width:number){return text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].reduce((a,c)=>a+(c.charCodeAt(0)>255?2:1),0)/Math.max(10,width-2))),0);}
function addSheet(book:ExcelJS.Workbook,sheet:ContactExcelSheet,index:number,meta:ReturnType<typeof contactExcelView>){
  const ws=book.addWorksheet(sheet.name,{views:[{state:'frozen',xSplit:2,ySplit:5,showGridLines:false}],properties:{tabColor:{argb:index?'FFE2E8F0':'FF1E3A5F'}}});
  ws.columns=sheet.widths.map(width=>({width}));
  ws.getCell('A2').value=titles[index];ws.getCell('A2').font={name:'Arial',size:15,bold:true,color:{argb:'FF16324F'}};ws.getRow(2).height=26;
  ws.getCell('A3').value=meta.market;ws.getCell('C3').value='人物资料条数';ws.getCell('D3').value=meta.personRows;ws.getCell('E3').value='渠道资料条数';ws.getCell('F3').value=meta.channelRows;
  for(const address of ['D3','F3'])ws.getCell(address).alignment={horizontal:'left',indent:1};
  if(index===0){ws.mergeCells(3,1,3,8);ws.getCell('A3').value=meta.contactSummary;ws.getCell('A3').font={name:'Arial',size:12,bold:true,color:{argb:'FF16324F'}};ws.getCell('A3').alignment={wrapText:true,vertical:'middle'};ws.getRow(3).height=36;}
  ws.getCell('A4').value=index===0?'先筛选“联系结果”。已验证邮箱仍需核对归属；标黄暂不发信。未找到者记录原因并继续下一位。':index===1?'公司和归属待确认的渠道分别记录；不能当作人物个人联系方式。':'原文和完整销售备注按顺序分段保留。可筛选企业、姓名和资料编号，点击网址回看来源。';
  ws.mergeCells(4,1,4,index===0?8:sheet.headers.length);ws.getRow(4).height=34;ws.getCell('A4').alignment={wrapText:true,vertical:'middle'};
  const rows=sheet.rows.map(row=>row.map((value,i)=>{
    if(value.length>32767)throw Error('CONTACT_EXCEL_CELL_TOO_LARGE');
    if(index===2&&i===8&&/^\d{4}-\d{2}-\d{2}T/.test(value)){const date=new Date(value);if(!Number.isNaN(date.valueOf()))return date;}
    return value===''?null:value;
  }));
  const headers=[...sheet.headers];if(index===2)headers[8]='获取时间（UTC）';
  ws.addTable({name:tableNames[index],ref:'A5',headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:headers.map(name=>({name,filterButton:true})),rows});
  ws.getRow(5).height=30;
  ws.eachRow((row,n)=>{if(n<5)return;row.eachCell(cell=>{cell.font={name:'Arial',size:11,...(n===5?{bold:true,color:{argb:'FFFFFFFF'}}:{color:{argb:'FF243746'}})};cell.alignment={vertical:'top',wrapText:true,...(n===5?{horizontal:'center'}:{})};});
    if(n>5){row.height=Math.max(index===0?64:40,Math.min(409,Math.max(...sheet.rows[n-6].map((v,i)=>displayLines(v,sheet.widths[i])))*15+10));
      if(sheet.linkColumn){const cell=row.getCell(sheet.linkColumn),target=url(String(cell.value||''));if(target){cell.value={text:target,hyperlink:target};cell.font={name:'Arial',size:11,color:{argb:'FF205DA3'},underline:true};}}
      if(index===0){
        const profile=row.getCell(7),target=url(String(profile.value||''));if(target){profile.value={text:target,hyperlink:target};profile.font={name:'Arial',size:11,color:{argb:'FF205DA3'},underline:true};}
        for(const column of [3,4,5,6,8]){const cell=row.getCell(column),text=String(cell.value||'');
          cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:text.includes('技术验证通过')?'FFE2F0D9':text.includes('冲突')||text.includes('归属未确认')?'FFFFF2CC':text.includes('未找到')?'FFF2F2F2':'FFF1F5F9'}};
        }
      }
      if(index===2)row.getCell(9).numFmt='yyyy-mm-dd hh:mm';
      if(sheet.decisionColumn){for(const column of [sheet.decisionColumn,sheet.decisionColumn+1])row.getCell(column).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}};
        row.getCell(sheet.decisionColumn).dataValidation={type:'list',allowBlank:false,formulae:['"未判断,保留,排除,待补充"'],showErrorMessage:true,errorTitle:'请选择判断',error:'请选择未判断、保留、排除或待补充。'};}
    }
  });
  if(!rows.length){ws.getCell('A6').value=index===0?'本次筛选尚未取得人物资料。':index===1?'本次筛选尚未取得公开联系渠道。':'本次筛选尚未取得来源。';ws.getCell('A6').font={name:'Arial',size:11};}
  ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};
}
export async function contactReviewXlsx(data:ReturnType<typeof contactExcelView>){
  const book=new ExcelJS.Workbook();book.creator='企业客户研究';book.subject='人物资料与公开联系渠道';
  data.sheets.forEach((sheet,index)=>addSheet(book,sheet,index,data));
  return new Uint8Array(await book.xlsx.writeBuffer());
}
