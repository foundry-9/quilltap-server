/**
 * Fold episode catch-up sweep (bug 232)
 *
 * The fold episode pass reads a bounded number of slices per fold, so a long
 * backlog (a regenerated chat's whole history) drains only as the chat folds
 * again. This sweep finds chats idle for more than two hours whose episode
 * watermark is behind their fold boundary and enqueues one MEMORY_EXTRACTION
 * job (`foldEpisodeCatchup: true`) per chat; each job continues itself until
 * the backlog is read. The LLM work runs in the job child like every other
 * extraction, not inline in the maintenance tick.
 *
 * Bounded: at most `FOLD_CATCHUP_MAX_CHATS` jobs per sweep; the rest are
 * logged and left for the next one.
 *
 * One chain per chat: a chat with any episode catch-up already queued or
 * running — the sweep's own job or a `continue-episode:` successor — is
 * skipped, whatever its anchor, so two jobs never read the same slices from
 * the same watermark. (The enqueue dedupe alone keys on the anchor, and the
 * sweep's anchor and a continuation's never match.)
 */

import { logger } from '@/lib/logger';
import { enqueueMemoryExtraction, type MemoryExtractionPayload } from '../queue-service';
import { getRepositories } from '@/lib/repositories/factory';
import type { ChatMetadata } from '@/lib/schemas/types';
import { findFoldEpisodeCatchupCandidates } from '@/lib/memory/fold-episode-catchup';
import { FOLD_CATCHUP_MAX_CHATS } from '@/lib/memory/fold-catchup';

const moduleLogger = logger.child({ module: 'maintenance.fold-episode-catchup' });

export interface FoldEpisodeCatchupSweepSummary {
  /** Chats a catch-up job was enqueued for. */
  enqueued: number;
  /** Eligible chats beyond the per-sweep cap, left for the next sweep. */
  deferred: number;
}

/** Chats (by user) with an episode catch-up job queued or running. */
async function chatsWithEpisodeCatchupInFlight(userIds: Iterable<string>): Promise<Set<string>> {
  const repos = getRepositories();
  const chatIds = new Set<string>();
  for (const userId of userIds) {
    const [pending, processing] = await Promise.all([
      repos.backgroundJobs.findByUserId(userId, 'PENDING'),
      repos.backgroundJobs.findByUserId(userId, 'PROCESSING'),
    ]);
    for (const job of [...pending, ...processing]) {
      if (job.type !== 'MEMORY_EXTRACTION') continue;
      const payload = job.payload as unknown as MemoryExtractionPayload;
      if (payload.foldEpisodeCatchup) chatIds.add(payload.chatId);
    }
  }
  return chatIds;
}

export async function enqueueFoldEpisodeCatchups(
  options: { now?: number; limit?: number; chats?: readonly ChatMetadata[] } = {},
): Promise<FoldEpisodeCatchupSweepSummary> {
  const limit = options.limit ?? FOLD_CATCHUP_MAX_CHATS;
  const { candidates, deferred } = await findFoldEpisodeCatchupCandidates({
    now: options.now,
    limit,
    chats: options.chats,
  });

  let inFlight = new Set<string>();
  if (candidates.length > 0) {
    try {
      inFlight = await chatsWithEpisodeCatchupInFlight(new Set(candidates.map(c => c.userId)));
    } catch (error) {
      // Without the job list the anchor dedupe still stops an identical job.
      moduleLogger.warn('Could not read in-flight jobs; relying on the enqueue dedupe', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let enqueued = 0;
  let alreadyRunning = 0;
  for (const candidate of candidates) {
    if (inFlight.has(candidate.chatId)) {
      alreadyRunning++;
      moduleLogger.debug('Episode catch-up already queued or running for chat; not starting another', {
        chatId: candidate.chatId,
      });
      continue;
    }
    try {
      await enqueueMemoryExtraction(candidate.userId, {
        chatId: candidate.chatId,
        turnOpenerMessageId: null,
        extractionAnchorMessageId: candidate.foldEndMessageId,
        connectionProfileId: candidate.connectionProfileId,
        foldEpisodeCatchup: true,
      });
      enqueued++;
      moduleLogger.debug('Enqueued fold episode catch-up', {
        chatId: candidate.chatId,
        foldEndMessageId: candidate.foldEndMessageId,
      });
    } catch (error) {
      moduleLogger.warn('Failed to enqueue fold episode catch-up', {
        chatId: candidate.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deferred > 0) {
    moduleLogger.info('Fold episode catch-up capped; remaining chats wait for the next sweep', {
      enqueued,
      alreadyRunning,
      deferred,
      limit,
    });
  } else {
    moduleLogger.debug('Fold episode catch-up sweep done', { enqueued, alreadyRunning });
  }
  return { enqueued, deferred };
}
