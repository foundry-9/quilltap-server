/**
 * Background-job processor — re-export shim
 *
 * As of the 2026-05 refactor, the processor runs in a forked child process.
 * The implementation moved to `host/processor-host.ts` (lifecycle) and
 * `host/job-dispatcher.ts` (claim loop, write applier). This file is a thin
 * re-export so legacy imports keep working — see callers under `app/api/v1/`,
 * `lib/background-jobs/`, and `lib/import/`.
 *
 * Exports that no longer have a backing implementation (the
 * memory-extraction concurrency slider was removed in favour of a flat
 * 4-job global cap) become deprecated no-ops below. They log a warning the
 * first time they're called so any straggler caller surfaces in the logs.
 */

import { logger } from '@/lib/logger';
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

/**
 * Legacy single-shot APIs. The new dispatcher claims jobs continuously, so
 * these are stubs that return zero-counters and emit a one-time deprecation
 * warning. Tests still mock these names; the runtime behaviour is provided
 * by the dispatcher.
 */
let processNextJobWarned = false;
export async function processNextJob(): Promise<boolean> {
  if (!processNextJobWarned) {
    processNextJobWarned = true;
    logger.warn('[processor.ts] processNextJob() is deprecated — the dispatcher claims jobs in the background. Call ensureProcessorRunning() instead.');
  }
  return false;
}

let processJobsWarned = false;
export async function processJobs(): Promise<{ processed: number; succeeded: number; failed: number }> {
  if (!processJobsWarned) {
    processJobsWarned = true;
    logger.warn('[processor.ts] processJobs() is deprecated — the dispatcher claims jobs in the background. Call ensureProcessorRunning() instead.');
  }
  return { processed: 0, succeeded: 0, failed: 0 };
}

export async function resetStuckJobs(timeoutMinutes?: number): Promise<number> {
  return dispatcherResetStuckJobs(timeoutMinutes);
}

/**
 * Legacy memory-extraction concurrency override. The runtime cap is now a
 * flat global 4-in-flight enforced by the dispatcher; per-type knobs are
 * gone. The `chatSettings.memoryExtractionConcurrency` instance setting is
 * still persisted (so the slider doesn't appear to lose its value if any UI
 * still reads/writes it), but it no longer affects job execution.
 *
 * The setter is a no-op that warns; the getter returns the legacy value
 * the caller might be displaying.
 */
let setOverrideWarned = false;
export function setMemoryExtractionConcurrencyOverride(_value: number): void {
  if (!setOverrideWarned) {
    setOverrideWarned = true;
    logger.warn('[processor.ts] setMemoryExtractionConcurrencyOverride is a no-op since the global concurrency cap was unified at 4. The chatSettings value is still persisted but has no runtime effect.');
  }
}

export function getMemoryExtractionConcurrencyOverride(): number {
  return 4;
}
