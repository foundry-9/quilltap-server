/**
 * Memory Consolidation Job Handler
 *
 * Runs one consolidation pass for one character (`lib/memory/consolidation.ts`):
 * cluster the character's mature hot memories per subject, fold each cluster
 * into a digest with one model call, send the members cold, and mirror the
 * digests into the character's `Commonplace/` vault folder.
 *
 * Runs in the forked job child: every repository write buffers and the parent
 * commits the batch at the end, which is why the service plans everything
 * before it writes. The vault mirror goes through host-RPC. The parent
 * announces the change (realtime `memories`, frozen-archive invalidation) from
 * its commit hooks.
 *
 * Automatic triggers (scheduled, watermark) bail when
 * `memoryConsolidation.enabled` is off; a manual run (Consolidate now, the
 * CLI) runs regardless. A dry run writes nothing and logs its report.
 *
 * A model call lost to a timeout does NOT fail the job: that would discard
 * every other cluster's digests with it. The lost cluster's rows stay
 * unconsidered and the next run retries them.
 */

import type { BackgroundJob } from '@/lib/schemas/types';
import { getMemoryConsolidationSettings } from '@/lib/instance-settings';
import { runConsolidation } from '@/lib/memory/consolidation';
import { logger } from '@/lib/logger';
import type { MemoryConsolidationPayload } from '../queue-service';

/**
 * Wall-clock budget for one job's model calls. The dispatcher marks a job that
 * has been PROCESSING for more than ten minutes as stuck; a run stops issuing
 * calls after this long and commits what it has, leaving the rest of the
 * backlog for the next pass.
 */
export const CONSOLIDATION_JOB_TIME_BUDGET_MS = 7 * 60 * 1000;

const log = logger.child({ module: 'jobs:memory-consolidation' });

export async function handleMemoryConsolidation(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as MemoryConsolidationPayload;
  if (!payload?.characterId) {
    log.warn('Consolidation job has no characterId; nothing to do', { jobId: job.id });
    return;
  }
  const trigger = payload.trigger ?? 'manual';

  if (trigger !== 'manual') {
    const settings = await getMemoryConsolidationSettings();
    if (!settings.enabled) {
      log.debug('Consolidation disabled; automatic job exits without running', {
        jobId: job.id,
        characterId: payload.characterId,
        trigger,
      });
      return;
    }
  }

  const report = await runConsolidation(payload.characterId, {
    dryRun: payload.dryRun === true,
    ...(payload.maxClustersPerRun !== undefined && { maxClustersPerRun: payload.maxClustersPerRun }),
    userId: job.userId,
    timeBudgetMs: CONSOLIDATION_JOB_TIME_BUDGET_MS,
    trigger,
  });

  if (report.dryRun) {
    // A job has no result slot, so a dry run's report goes to the log. The
    // manual surfaces call `runConsolidation` in-process for the full report.
    for (const cluster of report.clusters) {
      log.info('[Dry run] Consolidation cluster', {
        jobId: job.id,
        characterId: payload.characterId,
        bucket: `${cluster.bucket.kind}:${cluster.bucket.subjectName}`,
        clusterKind: cluster.clusterKind,
        status: cluster.status,
        members: cluster.memberIds.length,
        existingDigestId: cluster.existingDigestId,
        digests: cluster.digests.map((d) => ({ action: d.action, summary: d.summary, members: d.memberIds.length })),
        keepStandalone: cluster.keepStandalone.length,
        contradictions: cluster.contradictions.length,
        error: cluster.error,
      });
    }
  }

  log.info('Consolidation job complete', {
    jobId: job.id,
    characterId: payload.characterId,
    trigger,
    dryRun: report.dryRun,
    skippedReason: report.skippedReason,
    digestsCreated: report.stats.digestsCreated,
    digestsUpdated: report.stats.digestsUpdated,
    membersSuperseded: report.stats.membersSuperseded,
    clustersFailed: report.stats.clustersFailed,
    clustersDeferred: report.stats.clustersDeferred,
    durationMs: report.stats.durationMs,
  });
}
