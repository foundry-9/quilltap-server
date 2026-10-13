/**
 * Fold-pass catch-up sweep (memory refactor §3.7)
 *
 * The two fold-grain extraction passes run on the fold cadence, reading a
 * bounded number of slices per run. Short chats never fold, and a chat that
 * went quiet leaves its backlog unread; either way the pass's cursor is
 * behind. For each pass this sweep finds chats idle for more than two hours
 * whose cursor is behind (`findFoldCatchupCandidates`) and enqueues one
 * MEMORY_EXTRACTION job (`pass: 'other-fold' | 'episode-fold'`) per chat; each
 * job continues itself until the backlog is read. The LLM work runs in the job
 * child like every other extraction, not inline in the maintenance tick.
 *
 * Bounded: at most `FOLD_CATCHUP_MAX_CHATS` jobs per pass per sweep; the rest
 * are logged and left for the next one.
 *
 * One chain per chat and pass: a chat with a catch-up of that pass already
 * queued or running — the sweep's own job or a continuation — is skipped, so
 * two jobs never read the same slices from the same cursor (bug 232).
 */

import { logger } from '@/lib/logger';
import { enqueueMemoryExtraction, memoryExtractionPassOf, type MemoryExtractionPayload } from '../queue-service';
import { getRepositories } from '@/lib/repositories/factory';
import type { ChatMetadata } from '@/lib/schemas/types';
import type { ExtractionCursorMap, ExtractionCursorPass } from '@/lib/schemas/memory-extraction-cursor.types';
import { findFoldCatchupCandidates, FOLD_CATCHUP_MAX_CHATS } from '@/lib/memory/extraction';

const moduleLogger = logger.child({ module: 'maintenance.fold-catchup' });

export interface FoldCatchupSweepSummary {
  /** Chats a catch-up job was enqueued for. */
  enqueued: number;
  /** Eligible chats beyond the per-sweep cap, left for the next sweep. */
  deferred: number;
}

/** Chats (by user) with a catch-up of `pass` queued or running. */
async function chatsWithCatchupInFlight(pass: ExtractionCursorPass, userIds: Iterable<string>): Promise<Set<string>> {
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
      if (memoryExtractionPassOf(payload) === pass) chatIds.add(payload.chatId);
    }
  }
  return chatIds;
}

export async function enqueueFoldCatchups(
  pass: ExtractionCursorPass,
  options: {
    now?: number;
    limit?: number;
    chats?: readonly ChatMetadata[];
    cursors?: ReadonlyMap<string, ExtractionCursorMap>;
  } = {},
): Promise<FoldCatchupSweepSummary> {
  const limit = options.limit ?? FOLD_CATCHUP_MAX_CHATS;
  const { candidates, deferred } = await findFoldCatchupCandidates(pass, {
    now: options.now,
    limit,
    chats: options.chats,
    cursors: options.cursors,
  });

  let inFlight = new Set<string>();
  if (candidates.length > 0) {
    try {
      inFlight = await chatsWithCatchupInFlight(pass, new Set(candidates.map(c => c.userId)));
    } catch (error) {
      // Without the job list the enqueue dedupe still stops an identical job.
      moduleLogger.warn('Could not read in-flight jobs; relying on the enqueue dedupe', {
        pass,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let enqueued = 0;
  let alreadyRunning = 0;
  for (const candidate of candidates) {
    if (inFlight.has(candidate.chatId)) {
      alreadyRunning++;
      moduleLogger.debug('Catch-up already queued or running for chat; not starting another', {
        pass,
        chatId: candidate.chatId,
      });
      continue;
    }
    try {
      await enqueueMemoryExtraction(candidate.userId, {
        chatId: candidate.chatId,
        turnOpenerMessageId: null,
        extractionAnchorMessageId: candidate.anchorMessageId,
        connectionProfileId: candidate.connectionProfileId,
        pass,
      });
      enqueued++;
      moduleLogger.debug('Enqueued fold catch-up', { pass, chatId: candidate.chatId, anchor: candidate.anchorMessageId });
    } catch (error) {
      moduleLogger.warn('Failed to enqueue fold catch-up', {
        pass,
        chatId: candidate.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deferred > 0) {
    moduleLogger.info('Fold catch-up capped; remaining chats wait for the next sweep', { pass, enqueued, alreadyRunning, deferred, limit });
  } else {
    moduleLogger.debug('Fold catch-up sweep done', { pass, enqueued, alreadyRunning });
  }
  return { enqueued, deferred };
}
