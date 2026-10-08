/**
 * Fold-grain OTHER catch-up sweep
 *
 * Short chats never reach a fold, and a chat that went quiet mid-thread leaves
 * its tail past the last fold; either way the fold-grain OTHER pass
 * (`lib/memory/fold-other-pass.ts`) has not seen it. This sweep finds chats
 * idle for more than two hours whose last message is past
 * `chats.otherExtractionWatermarkMessageId` and enqueues one MEMORY_EXTRACTION
 * job (`foldOtherCatchup: true`) per chat. The LLM work therefore runs in the
 * job child like every other extraction, not inline in the maintenance tick.
 *
 * Bounded: at most `FOLD_OTHER_CATCHUP_MAX_CHATS` jobs per sweep; the rest are
 * logged and left for the next one. Does nothing when `otherPass` is 'turn'.
 */

import { logger } from '@/lib/logger';
import { enqueueMemoryExtraction } from '../queue-service';
import {
  findFoldOtherCatchupCandidates,
  FOLD_OTHER_CATCHUP_MAX_CHATS,
} from '@/lib/memory/fold-other-pass';

const moduleLogger = logger.child({ module: 'maintenance.fold-other-catchup' });

export interface FoldOtherCatchupSweepSummary {
  /** Chats a catch-up job was enqueued for. */
  enqueued: number;
  /** Eligible chats beyond the per-sweep cap, left for the next sweep. */
  deferred: number;
}

export async function enqueueFoldOtherCatchups(
  options: { now?: number; limit?: number } = {},
): Promise<FoldOtherCatchupSweepSummary> {
  const limit = options.limit ?? FOLD_OTHER_CATCHUP_MAX_CHATS;
  const { candidates, deferred } = await findFoldOtherCatchupCandidates({ now: options.now, limit });

  let enqueued = 0;
  for (const candidate of candidates) {
    try {
      await enqueueMemoryExtraction(candidate.userId, {
        chatId: candidate.chatId,
        turnOpenerMessageId: null,
        extractionAnchorMessageId: candidate.lastMessageId,
        connectionProfileId: candidate.connectionProfileId,
        foldOtherCatchup: true,
      });
      enqueued++;
      moduleLogger.debug('Enqueued fold-grain OTHER catch-up', {
        chatId: candidate.chatId,
        lastMessageId: candidate.lastMessageId,
      });
    } catch (error) {
      moduleLogger.warn('Failed to enqueue fold-grain OTHER catch-up', {
        chatId: candidate.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deferred > 0) {
    moduleLogger.info('Fold-grain OTHER catch-up capped; remaining chats wait for the next sweep', {
      enqueued,
      deferred,
      limit,
    });
  } else {
    moduleLogger.debug('Fold-grain OTHER catch-up sweep done', { enqueued });
  }
  return { enqueued, deferred };
}
