/**
 * The job child's plugin-readiness gate (bug 243).
 *
 * The child loads the plugin/provider registry asynchronously at start-up,
 * but the parent forks it lazily on the first job and sends that job at once.
 * A handler that reached `providerRegistry` before the load finished threw
 * "Provider '…' not found in registry". Memory embeds retried and recovered;
 * help-doc sections catch per-section failures and were skipped, so on a
 * BUILTIN instance — whose first jobs at boot are the help-doc sync — help
 * search kept no vectors.
 *
 * `startPluginInitialization` begins the load once; `whenPluginsReady`
 * resolves when it has settled (success or failure — a failed load is logged
 * by the caller and handlers then fail as they always did), or after
 * {@link PLUGIN_READY_TIMEOUT_MS}, so a hung load cannot stall the queue.
 *
 * @module background-jobs/child/plugin-readiness
 */

import { logger } from '@/lib/logger';

const log = logger.child({ module: 'jobs:child:plugin-readiness' });

/** Longest a job waits for the plugin load before running anyway. */
export const PLUGIN_READY_TIMEOUT_MS = 60_000;

let settled: Promise<void> | null = null;
let done = false;

/**
 * Start the plugin load (idempotent: a second call returns the first load).
 * The returned promise never rejects.
 */
export function startPluginInitialization(init: () => Promise<unknown>): Promise<void> {
  if (!settled) {
    settled = (async () => {
      try {
        await init();
      } catch {
        // The caller logs its own failure; readiness only tracks settling.
      } finally {
        done = true;
      }
    })();
  }
  return settled;
}

/**
 * Resolve once the plugin load has settled, or after `timeoutMs`. Resolves at
 * once when no load was started (nothing to wait for) or it already settled.
 */
export async function whenPluginsReady(timeoutMs: number = PLUGIN_READY_TIMEOUT_MS): Promise<void> {
  if (!settled || done) return;
  log.debug('Job waiting for the plugin registry to load');
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const outcome = await Promise.race([settled.then(() => 'ready' as const), timedOut]);
  if (timer) clearTimeout(timer);
  if (outcome === 'timeout') {
    log.warn('Plugin registry still loading; running the job anyway', { timeoutMs });
  } else {
    log.debug('Plugin registry loaded; running the job');
  }
}

/** Test seam: forget any load. */
export function resetPluginReadinessForTests(): void {
  settled = null;
  done = false;
}
