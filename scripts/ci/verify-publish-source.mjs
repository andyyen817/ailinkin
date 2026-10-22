import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sha=b=>createHash('sha256').update(b).digest('hex');
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync('release-manifest.json','utf8'));
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
assert.ok(files.length>0);
const secrets=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/(?:postgres(?:ql)?|redis|https?):\/\/[^\s/'"]+:[^\s@'"]+@/,/gh[pousr]_[A-Za-z0-9_]{25,}/,/\b(?:sk-proj-|sk-ant-|AKIA)[A-Za-z0-9_-]{16,}/];
for(const name of files){
 assert.ok(!name.split('/').some(p=>['.runtime','evidence','outputs','output','工作交流','node_modules','.next'].includes(p)||p.startsWith('.env')),`PRIVATE_PATH ${name}`);
 const p=path.resolve(name);assert.ok(p.startsWith(root+path.sep));assert.ok(!fs.lstatSync(p).isSymbolicLink());
 const content=fs.readFileSync(p,'utf8');for(const rule of secrets)assert.ok(!rule.test(content),`SECRET_PATTERN ${name}`);
}
for(const [name,hash] of Object.entries(manifest.source)){
 assert.ok(files.includes(name),`MISSING_SOURCE ${name}`);
 assert.equal(sha(fs.readFileSync(name)),hash,`MANIFEST_DRIFT ${name}`);
}
for(const name of ['tests/contacts.test.ts','tests/policy.test.ts','tests/contact-csv-regression.test.ts'])assert.ok(files.includes(name));
assert.match(manifest.contentSha,/^[a-f0-9]{64}$/);
if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`content_sha=${manifest.contentSha}\n`);
console.log(JSON.stringify({result:'PASS',trackedFiles:files.length,sourceFiles:Object.keys(manifest.source).length,contentSha:manifest.contentSha}));
