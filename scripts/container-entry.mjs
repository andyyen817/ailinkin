import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runtimeAllowed} from './runtime-guard.mjs';
export function containerCommands(role,env){
  if(!['web','worker'].includes(role))throw Error('SERVICE_ROLE must be web or worker');
  if(!runtimeAllowed(role,env))return [];
  const commands=[role==='web'?['scripts/start.mjs']:['--conditions=react-server','dist/worker.mjs']];
  if(role==='web'&&env.OPERATOR_SELF_SERVICE_ENABLED==='true'&&runtimeAllowed('worker',env))commands.push(['--conditions=react-server','dist/operator-worker.mjs']);
  return commands;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const children=containerCommands(process.env.SERVICE_ROLE,process.env).map(args=>spawn(process.execPath,args,{stdio:'inherit',env:process.env}));
  if(!children.length)console.log('PREPARATION_STOPPED: no business or worker process started');
  let stopping=false;
  const stop=code=>{if(stopping)return;stopping=true;for(const child of children)child.kill();process.exitCode=code;};
  for(const child of children){child.on('error',()=>stop(1));child.on('exit',code=>stop(code??1));}
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop(0));
}
