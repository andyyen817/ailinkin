import test from 'node:test';
import assert from 'node:assert/strict';
import {stringify} from 'csv-stringify/sync';
import {selectRelease} from '../scripts/ci/select-release.mjs';
import {releaseRequest} from '../scripts/ci/request-release.mjs';
import {checkCsv} from '../scripts/ci/business-acceptance.mjs';
const sha='a'.repeat(40),repo='andyyen817/ailinkin';
const run={id:100,run_number:1,run_attempt:1,head_sha:sha,head_branch:'main',path:'.github/workflows/ci.yml',
  event:'push',repository:{full_name:repo},status:'completed',conclusion:'success'};
test('release selects exact successful main build and refuses failed newer run',()=>{
  assert.equal(selectRelease({repo,sha,mainSha:sha,runs:[run]}).ciRun,'100');
  assert.throws(()=>selectRelease({repo,sha,mainSha:'b'.repeat(40),runs:[run]}));
  assert.throws(()=>selectRelease({repo,sha,mainSha:sha,runs:[run,{...run,id:101,run_number:2,conclusion:'failure'}]}));
});
test('release requires explicit manual event, pinned host and existing access',()=>{
  const input={GITHUB_REPOSITORY:repo,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SHA:sha,
    RELEASE_CI_RUN:'100',RELEASE_CI_ATTEMPT:'1',GITHUB_RUN_ID:'200',RELEASE_IMAGE:`ghcr.io/${repo}:sha-${sha}-100-1`,
    RELEASE_PRIVATE_KEY:'fixture-not-a-key',RELEASE_HOST_KEY:'ssh-ed25519 AAAA',GITHUB_TOKEN:'fixture-not-a-token'};
  assert.equal(releaseRequest(input).commit,sha);
  for(const field of ['RELEASE_PRIVATE_KEY','RELEASE_HOST_KEY','GITHUB_TOKEN'])assert.throws(()=>releaseRequest({...input,[field]:''}));
  assert.throws(()=>releaseRequest({...input,GITHUB_EVENT_NAME:'push'}));
  assert.throws(()=>releaseRequest({...input,RELEASE_IMAGE:'image:latest'}));
});
test('business acceptance checks real downloaded data including multiline notes and DNC',()=>{
  const notes='one\ntwo, comma';
  const row={name:'自动验收20261021-1811',company:'客户库自动验收（非真实客户）',email:'qa-20261021-1811@example.invalid',
    notes,stage:'有意向',doNotContact:'true',notInterested:'true'};
  const bytes=(rows:object[])=>Buffer.from(stringify(rows,{header:true,quoted:true,record_delimiter:'\r\n'}));
  assert.equal(checkCsv(bytes([row]),notes).fixtureVerified,true);
  assert.throws(()=>checkCsv(bytes([row,row]),notes));
  assert.throws(()=>checkCsv(bytes([{...row,notes:'truncated'}]),notes));
  assert.throws(()=>checkCsv(bytes([{...row,doNotContact:'false'}]),notes));
});
