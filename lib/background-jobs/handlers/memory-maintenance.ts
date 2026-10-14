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
import { getRepositories } from '@/lib/repositories/factory';
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
 * `Commonplace/` file behind. Honoured only outside production
 * (`NODE_ENV !== 'production'`): a stray variable in a deployment is ignored,
 * with a warning, rather than failing every run. Note that the near-duplicate
 * fold has already committed in the parent by then; only the job's own batch
 * is lost.
 */
export const MAINTENANCE_FAIL_AFTER_PLAN_ENV = 'QUILLTAP_TEST_MAINTENANCE_FAIL_AFTER_PLAN';

/** How far a job deferred behind a running one is pushed back. */
export const MAINTENANCE_DEFER_MS = 2 * 60 * 1000;

const log = logger.child({ module: 'jobs:memory-maintenance' });

/** True when `a` was enqueued before `b` (ties broken by id), so `b` yields to it. */
function enqueuedBefore(a: BackgroundJob, b: BackgroundJob): boolean {
  const at = Date.parse(a.createdAt);
  const bt = Date.parse(b.createdAt);
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at < bt;
  return a.id < b.id;
}

/**
 * The id of an older PROCESSING maintenance job for this job's character, if
 * any. Only the younger of two concurrent runs yields, so two jobs that start
 * together never both defer.
 */
async function findOtherRunningMaintenance(job: BackgroundJob): Promise<string | null> {
  const characterId = (job.payload as Record<string, unknown> | undefined)?.characterId;
  try {
    const processing = await getRepositories().backgroundJobs.findByUserId(job.userId, 'PROCESSING');
    const other = processing.find(
      (j) =>
        j.id !== job.id &&
        j.type === 'MEMORY_MAINTENANCE' &&
        (j.payload as Record<string, unknown>).characterId === characterId &&
        enqueuedBefore(j, job),
    );
    return other?.id ?? null;
  } catch (error) {
    log.warn('Could not check for a concurrent maintenance run; running anyway', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function handleMemoryMaintenance(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as MemoryMaintenancePayload;
  if (!payload?.characterId) {
    log.warn('Maintenance job has no characterId; nothing to do', { jobId: job.id });
    return;
  }

  // One run per character at a time (bug 221). A running job never absorbs a
  // new request (it has already read the corpus), so this one may have been
  // enqueued beside it: hand it back to the queue for later and stand down.
  const running = await findOtherRunningMaintenance(job);
  if (running) {
    const { enqueueMemoryMaintenance } = await import('../queue-service');
    const successorId = await enqueueMemoryMaintenance(job.userId, payload, {
      scheduledAt: new Date(Date.now() + MAINTENANCE_DEFER_MS),
    });
    log.info('Another maintenance run is under way for the character; deferred', {
      jobId: job.id,
      characterId: payload.characterId,
      runningJobId: running,
      successorId,
    });
    return;
  }

  const report = await runMaintenance(
    {
      characterId: payload.characterId,
      reason: payload.reason ?? 'manual',
      ...(payload.exemptPhases ? { exemptPhases: payload.exemptPhases } : {}),
      ...(payload.phases ? { phases: payload.phases } : {}),
      ...(payload.settings ? { settings: payload.settings } : {}),
    },
    { userId: job.userId, timeBudgetMs: MAINTENANCE_JOB_TIME_BUDGET_MS },
  );
  const summary = summarizeMaintenance(report);

  if (process.env[MAINTENANCE_FAIL_AFTER_PLAN_ENV] === '1') {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error('Maintenance failed after planning (test flag)');
    }
    log.warn('Ignoring the maintenance fail-after-plan test flag in production', {
      jobId: job.id,
      env: MAINTENANCE_FAIL_AFTER_PLAN_ENV,
    });
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
