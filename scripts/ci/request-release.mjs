import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function releaseRequest(env) {
  assert.equal(env.GITHUB_REPOSITORY,'andyyen817/ailinkin','WRONG_REPOSITORY');
  assert.equal(env.GITHUB_REF,'refs/heads/main','MAIN_ONLY');
  assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch','MANUAL_RELEASE_ONLY');
  assert.match(env.GITHUB_SHA||'',/^[a-f0-9]{40}$/,'INVALID_COMMIT');
  for(const key of ['RELEASE_CI_RUN','RELEASE_CI_ATTEMPT','GITHUB_RUN_ID']) assert.match(env[key]||'',/^[1-9][0-9]*$/,'INVALID_RUN');
  const image=`ghcr.io/andyyen817/ailinkin:sha-${env.GITHUB_SHA}-${env.RELEASE_CI_RUN}-${env.RELEASE_CI_ATTEMPT}`;
  assert.equal(env.RELEASE_IMAGE,image,'UNVERIFIED_IMAGE');
  assert.ok(env.RELEASE_PRIVATE_KEY && env.RELEASE_HOST_KEY && env.GITHUB_TOKEN,'RELEASE_ACCESS_NOT_CONFIGURED');
  assert.match(env.RELEASE_HOST_KEY,/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]+)?$/,'INVALID_PINNED_HOST_KEY');
  return {commit:env.GITHUB_SHA,image,ciRun:env.RELEASE_CI_RUN,ciAttempt:env.RELEASE_CI_ATTEMPT,
    releaseRun:env.GITHUB_RUN_ID,registryToken:env.GITHUB_TOKEN};
}

async function main() {
  const request=releaseRequest(process.env);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'search-release-'));
  fs.chmodSync(temporary,0o700);
  try {
    const key=path.join(temporary,'key'),known=path.join(temporary,'known_hosts');
    fs.writeFileSync(key,process.env.RELEASE_PRIVATE_KEY+'\n',{mode:0o600});
    fs.writeFileSync(known,'43.134.7.133 '+process.env.RELEASE_HOST_KEY+'\n',{mode:0o600});
    const args=['-F','/dev/null','-i',key,'-o','IdentitiesOnly=yes','-o','BatchMode=yes',
      '-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile=${known}`,'-o','ConnectTimeout=15',
      '-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','search-release@43.134.7.133','publish'];
    const result=spawnSync('ssh',args,{input:JSON.stringify(request)+'\n',encoding:'utf8',timeout:780000,maxBuffer:1048576});
    assert.ok(!result.error && result.status===0,'DEPLOYMENT_STOPPED_CHECK_SERVER_RECEIPT');
    const receipt=JSON.parse(result.stdout);
    assert.equal(receipt.state,'DEPLOYED_HEALTHY');assert.equal(receipt.commit,request.commit);
    assert.equal(receipt.image,request.image);assert.equal(receipt.databaseChanged,false);
    assert.equal(receipt.mailEnabled,false);
    console.log(JSON.stringify(receipt));
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### 已发布并通过服务检查\n\n版本：\`${request.commit}\`\n\n[打开正式客户库](https://aicustomersearch.vaneapex.cn/contacts?tenantId=6e0df94e-71cc-4291-9e8c-7a49b39e02b7)\n\n服务检查与登录、保存、下载的浏览器业务验收分别记录。\n`);
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await main();
