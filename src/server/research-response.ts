import 'server-only';
import type {Campaign} from '@/domain/research';
import {present as rawPresent} from './research-service';
import {reconcileVerifiedWebsiteAttempts} from '../../scripts/research/buyer-resolution.mjs';
export {connectionStatus,executeSearch,providerConfig} from './research-service';
export function present(row:Campaign,milestone?:any){
  const view={...row,data:structuredClone(row.data)};
  reconcileVerifiedWebsiteAttempts(view.data,view.data.sourcePipeline?.entities||[]);
  return rawPresent(view,milestone);
}
