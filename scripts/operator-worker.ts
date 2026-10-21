import {requireRuntime} from './runtime-guard.mjs';
requireRuntime('worker');
const {runPersonWorker}=await import('../src/worker/person-research-worker');
await runPersonWorker(Infinity);
