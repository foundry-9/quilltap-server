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
 */

import { logger } from '@/lib/logger';
import { enqueueMemoryExtraction } from '../queue-service';
import { findFoldEpisodeCatchupCandidates } from '@/lib/memory/fold-episode-catchup';
import { FOLD_CATCHUP_MAX_CHATS } from '@/lib/memory/fold-catchup';

const moduleLogger = logger.child({ module: 'maintenance.fold-episode-catchup' });

export interface FoldEpisodeCatchupSweepSummary {
  /** Chats a catch-up job was enqueued for. */
  enqueued: number;
  /** Eligible chats beyond the per-sweep cap, left for the next sweep. */
  deferred: number;
}

export async function enqueueFoldEpisodeCatchups(
  options: { now?: number; limit?: number } = {},
): Promise<FoldEpisodeCatchupSweepSummary> {
  const limit = options.limit ?? FOLD_CATCHUP_MAX_CHATS;
  const { candidates, deferred } = await findFoldEpisodeCatchupCandidates({ now: options.now, limit });

  let enqueued = 0;
  for (const candidate of candidates) {
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
      deferred,
      limit,
    });
  } else {
    moduleLogger.debug('Fold episode catch-up sweep done', { enqueued });
  }
  return { enqueued, deferred };
}
