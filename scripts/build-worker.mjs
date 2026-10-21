import {build} from 'esbuild';
await build({entryPoints:['scripts/worker.ts'],outfile:'dist/worker.mjs',bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',conditions:['react-server'],sourcemap:false});
await build({entryPoints:['scripts/operator-worker.ts'],outfile:'dist/operator-worker.mjs',bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',conditions:['react-server'],sourcemap:false});
console.log('WORKER_BUNDLE_READY');
