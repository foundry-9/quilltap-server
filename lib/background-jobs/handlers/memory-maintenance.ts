/**
 * Memory Maintenance Job Handler (memory refactor §3.9)
 *
 * Runs `runMaintenance` for one character in the forked child: fold
 * near-duplicates → consolidate → demote → retire → mirror, each skippable by
 * settings. Consolidation, demotion and retirement buffer and commit with the
 * job; the near-duplicate fold commits in the parent over host-RPC. Every
 * effect waits for the commit: the dispatcher's hooks invalidate the frozen
 * archives, publish `memories`, write the `Commonplace/` mirror from the
 * committed rows (bug 208) and record the summary this handler hands back
 * (`setJobResult`) in the parent's ledger.
 *
 * A consolidation model call lost to a timeout does not fail the job — that
 * would discard every other cluster's digests with it; its rows stay
 * unconsidered and the next run retries them.
 */

import type { BackgroundJob } from '@/lib/schemas/types';
import { runMaintenance, summarizeMaintenance } from '@/lib/memory/maintenance';
import { setJobResult } from '@/lib/background-jobs/child/child-repositories-proxy';
import { logger } from '@/lib/logger';
import type { MemoryMaintenancePayload } from '../queue-service';

/**
 * Wall-clock budget for one job's consolidation calls. The dispatcher marks a
 * job PROCESSING for more than ten minutes as stuck; a run stops issuing calls
 * after this long and commits what it has.
 */
export const MAINTENANCE_JOB_TIME_BUDGET_MS = 7 * 60 * 1000;

/**
 * Test flag: fail the job after every phase has planned and buffered its
 * writes, so the batch never commits. Used to show that a failed run leaves no
 * `Commonplace/` file behind.
 */
export const MAINTENANCE_FAIL_AFTER_PLAN_ENV = 'QUILLTAP_TEST_MAINTENANCE_FAIL_AFTER_PLAN';

const log = logger.child({ module: 'jobs:memory-maintenance' });

export async function handleMemoryMaintenance(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as MemoryMaintenancePayload;
  if (!payload?.characterId) {
    log.warn('Maintenance job has no characterId; nothing to do', { jobId: job.id });
    return;
  }

  const report = await runMaintenance(
    {
      characterId: payload.characterId,
      reason: payload.reason ?? 'manual',
      ...(payload.phases ? { phases: payload.phases } : {}),
      ...(payload.settings ? { settings: payload.settings } : {}),
    },
    { userId: job.userId, timeBudgetMs: MAINTENANCE_JOB_TIME_BUDGET_MS },
  );
  const summary = summarizeMaintenance(report);

  if (process.env[MAINTENANCE_FAIL_AFTER_PLAN_ENV] === '1') {
    throw new Error('Maintenance failed after planning (test flag)');
  }

  setJobResult(summary);
  log.info('Maintenance job complete', {
    jobId: job.id,
    characterId: payload.characterId,
    reason: summary.reason,
    ran: summary.phases.filter((p) => p.status === 'ran').map((p) => p.phase),
    folded: summary.fold?.folded ?? null,
    digestsCreated: summary.consolidation?.digestsCreated ?? null,
    demoted: summary.demote?.demoted ?? null,
    retired: summary.retire?.retired ?? null,
    durationMs: summary.durationMs,
  });
}
