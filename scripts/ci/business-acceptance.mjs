import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from 'csv-parse/sync';

const origin='https://aicustomersearch.vaneapex.cn';
const tenant='6e0df94e-71cc-4291-9e8c-7a49b39e02b7';
const name='自动验收20261021-1811',email='qa-20261021-1811@example.invalid';
export function checkCsv(bytes,notes) {
  assert.ok(bytes.length>0 && bytes.length<=1048576,'EXPORT_SIZE');
  const rows=parse(bytes,{columns:true,bom:true,skip_empty_lines:true});
  const matches=rows.filter(row=>row.email===email);
  assert.equal(matches.length,1,'FIXTURE_MISSING_OR_DUPLICATED');
  const row=matches[0];
  assert.equal(row.name,name);assert.equal(row.company,'客户库自动验收（非真实客户）');
  assert.equal(row.notes,notes);assert.equal(row.doNotContact,'true');
  assert.equal(row.notInterested,'true');assert.equal(row.stage,'有意向');
  return {downloadedRows:rows.length,fixtureVerified:true};
}

async function main() {
  const env=process.env;
  assert.equal(env.GITHUB_REPOSITORY,'andyyen817/ailinkin');
  assert.equal(env.GITHUB_REF,'refs/heads/main');
  assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
  assert.match(env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);
  assert.match(env.GITHUB_RUN_ID||'',/^[1-9][0-9]*$/);
  assert.ok(env.ACCEPTANCE_PASSWORD,'BROWSER_ACCEPTANCE_NOT_CONFIGURED');
  const {chromium}=await import('playwright');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'search-acceptance-'));
  fs.chmodSync(directory,0o700);
  let browser,page,step='login',loginStatus=null,loginRequested=false,loginPageStatus=null,pageErrors=0,loginUi=null;
  const watchdog=setTimeout(()=>process.exit(1),300000);
  try {
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({acceptDownloads:true});
    page=await context.newPage();page.setDefaultTimeout(20000);
    page.on('pageerror',()=>pageErrors++);
    page.on('request',request=>{if(request.url()===origin+'/api/auth/sign-in/email')loginRequested=true;});
    page.on('response',response=>{if(response.url()===origin+'/api/auth/sign-in/email')loginStatus=response.status();});
    step='login-page';
    const loginPage=await page.goto(origin+'/login',{waitUntil:'networkidle'});
    loginPageStatus=loginPage?.status();
    loginUi={emailInputs:await page.getByLabel('企业邮箱',{exact:true}).count(),submitButtons:await page.getByRole('button',{name:'登录工作台'}).count()};
    step='login-ready';
    // Wait for a real React interaction before entering credentials or submitting.
    await page.getByRole('button',{name:'显示密码',exact:true}).click();
    await page.getByRole('button',{name:'隐藏密码',exact:true}).waitFor();
    await page.getByRole('button',{name:'隐藏密码',exact:true}).click();
    await page.getByRole('button',{name:'显示密码',exact:true}).waitFor();
    step='login-submit';
    await page.getByLabel('企业邮箱',{exact:true}).fill('release-check@ailinkin.invalid');
    await page.getByLabel('密码',{exact:true}).fill(env.ACCEPTANCE_PASSWORD);
    await page.getByRole('button',{name:'登录工作台'}).click();
    await page.waitForURL(origin+'/workspace');
    step='save';
    await page.goto(origin+'/contacts?tenantId='+tenant,{waitUntil:'domcontentloaded'});
    await page.getByRole('textbox',{name:'搜索客户',exact:true}).fill(email);
    await page.getByRole('button',{name:'筛选',exact:true}).click();
    await page.getByRole('button',{name:'编辑 '+name,exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'邮箱',exact:true}).inputValue(),email);
    assert.equal(await page.getByRole('textbox',{name:'公司名称',exact:true}).inputValue(),'客户库自动验收（非真实客户）');
    assert.ok(await page.getByRole('checkbox',{name:'禁止联系（保存后不可在此清除）',exact:true}).isChecked());
    const notesBox=page.getByRole('textbox',{name:'备注',exact:true});
    const oldNotes=await notesBox.inputValue();
    assert.ok(oldNotes.startsWith('仅测试保存、筛选、名单、重复导入和下载。非真实客户，不发信。\n备注第二行，保留逗号。'));
    const baseNotes=oldNotes.replace(/\n\n发布验收：[^\n]+$/,'');
    const notes=baseNotes+'\n\n发布验收：'+env.GITHUB_SHA+' / '+env.GITHUB_RUN_ID;
    await notesBox.fill(notes);
    await page.getByRole('combobox',{name:'跟进阶段',exact:true}).selectOption({label:'有意向'});
    await page.getByRole('checkbox',{name:'不感兴趣',exact:true}).check();
    await page.getByRole('button',{name:'保存客户',exact:true}).click();
    await page.getByRole('status').filter({hasText:'客户已保存。'}).waitFor();
    step='reload';await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'编辑 '+name,exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'备注',exact:true}).inputValue(),notes);
    await page.getByRole('button',{name:'关闭编辑',exact:true}).click();
    step='download';
    const existing=await page.locator('[data-job-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-job-id')));
    await page.getByRole('button',{name:'生成客户 CSV',exact:true}).click();
    await page.waitForFunction(ids=>Array.from(document.querySelectorAll('[data-job-id]')).some(n=>!ids.includes(n.getAttribute('data-job-id'))),existing);
    const fresh=page.locator('[data-job-id]').filter({has:page.getByRole('button',{name:'下载 CSV',exact:true})});
    let selected;
    for(let attempt=0;attempt<40;attempt++) {
      for(const item of await fresh.all())if(!existing.includes(await item.getAttribute('data-job-id')))selected=item;
      if(selected)break;
      await page.waitForTimeout(1000);
    }
    assert.ok(selected,'NEW_EXPORT_NOT_READY');
    const downloadPromise=page.waitForEvent('download');
    await selected.getByRole('button',{name:'下载 CSV',exact:true}).click();
    const download=await downloadPromise;
    assert.equal(await download.failure(),null,'DOWNLOAD_FAILED');
    const target=path.join(directory,'contacts.csv');await download.saveAs(target);
    const result=checkCsv(fs.readFileSync(target),notes);
    console.log(JSON.stringify({state:'BUSINESS_ACCEPTED',commit:env.GITHUB_SHA,login:true,saved:true,reloaded:true,...result}));
    if(env.GITHUB_STEP_SUMMARY)fs.appendFileSync(env.GITHUB_STEP_SUMMARY,
      `### 正式页面验收通过\n\n账号密码登录、保存、刷新、实际下载均通过。\n\n版本：\`${env.GITHUB_SHA}\`\n\n只修改已标记禁止联系的验收记录。原始客户文件未上传为构建产物。\n`);
  } catch (error) {
    const failure=error?.name==='TimeoutError'?'TIMEOUT':'CHECK_FAILED';
    const pathname=page?new URL(page.url()).pathname:null;
    console.error(JSON.stringify({state:'BUSINESS_ACCEPTANCE_FAILED',step,commit:env.GITHUB_SHA,failure,pathname,loginRequested,loginStatus,loginPageStatus,loginUi,pageErrors}));process.exitCode=1;
  } finally {
    clearTimeout(watchdog);await browser?.close();fs.rmSync(directory,{recursive:true,force:true});
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await main();
