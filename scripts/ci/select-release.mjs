import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

export const repository = 'andyyen817/ailinkin';
export function selectRelease({repo, sha, mainSha, runs}) {
  assert.equal(repo, repository, 'WRONG_REPOSITORY');
  assert.match(sha, /^[a-f0-9]{40}$/, 'INVALID_COMMIT');
  assert.equal(sha, mainSha, 'MAIN_CHANGED_RUN_RELEASE_AGAIN');
  const candidates = runs.filter(r => r.head_sha === sha && r.head_branch === 'main'
    && r.path === '.github/workflows/ci.yml' && ['push','workflow_dispatch'].includes(r.event)
    && r.repository?.full_name === repository);
  assert.ok(candidates.length, 'NO_BUILD_FOR_THIS_COMMIT');
  candidates.sort((a,b) => b.run_number-a.run_number || b.run_attempt-a.run_attempt);
  const run = candidates[0];
  assert.equal(run.status, 'completed', 'BUILD_NOT_FINISHED');
  assert.equal(run.conclusion, 'success', 'LATEST_BUILD_FAILED');
  for (const n of [run.id,run.run_number,run.run_attempt]) assert.ok(Number.isSafeInteger(n) && n>0, 'INVALID_RUN');
  return {commit:sha, ciRun:String(run.id), ciAttempt:String(run.run_attempt),
    image:`ghcr.io/${repository}:sha-${sha}-${run.id}-${run.run_attempt}`};
}

async function main() {
  const {GITHUB_REPOSITORY:repo,GITHUB_SHA:sha,GITHUB_TOKEN:token,GITHUB_OUTPUT:output} = process.env;
  assert.equal(repo,repository); assert.match(sha||'',/^[a-f0-9]{40}$/);
  assert.ok(token && output, 'MISSING_ACTIONS_CONTEXT');
  async function get(path) {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
      signal:AbortSignal.timeout(30000)});
    assert.ok(response.ok, `GITHUB_API_${response.status}`);
    return response.json();
  }
  const [head,builds] = await Promise.all([get('commits/main'),
    get(`actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=100`)]);
  const release=selectRelease({repo,sha,mainSha:head.sha,runs:builds.workflow_runs});
  for (const [key,value] of Object.entries(release)) fs.appendFileSync(output,`${key}=${value}\n`);
  console.log(JSON.stringify({...release,state:'BUILD_SELECTED_NOT_DEPLOYED'}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await main();
