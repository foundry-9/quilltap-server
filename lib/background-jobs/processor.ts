/**
 * Background-job processor — re-export shim
 *
 * As of the 2026-05 refactor, the processor runs in a forked child process.
 * The implementation moved to `host/processor-host.ts` (lifecycle) and
 * `host/job-dispatcher.ts` (claim loop, write applier). This file is a thin
 * re-export so legacy imports keep working — see callers under `app/api/v1/`,
 * `lib/background-jobs/`, and `lib/import/`.
 */

import { resetStuckJobs as dispatcherResetStuckJobs } from './host/job-dispatcher';

export {
  ensureProcessorRunning,
  stopProcessor,
  isProcessorRunning,
  getProcessorStatus,
  wakeProcessor,
  notifyChild,
} from './host/processor-host';

/**
 * Legacy alias for `ensureProcessorRunning`. Kept so existing callers and
 * the API route at `app/api/v1/system/tools/route.ts` continue to compile;
 * starting the processor is idempotent in the new model.
 */
export function startProcessor(): void {
  const { ensureProcessorRunning } = require('./host/processor-host') as typeof import('./host/processor-host');
  ensureProcessorRunning();
}

export async function resetStuckJobs(timeoutMinutes?: number): Promise<number> {
  return dispatcherResetStuckJobs(timeoutMinutes);
}

