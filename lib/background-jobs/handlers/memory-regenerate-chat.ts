/**
 * Memory Regenerate Chat Job Handler
 *
 * Wipes every memory tied to one chat (with vector store cleanup) and
 * re-enqueues per-turn MEMORY_EXTRACTION jobs so the current extraction
 * pipeline rebuilds the chat's memories from scratch.
 *
 * One MEMORY_EXTRACTION job is enqueued per user-message turn opener.
 * The transcript builder (lib/services/chat-message/turn-transcript.ts)
 * walks forward from each opener and stops at the next user message, so
 * one job per user message exactly tiles the chat into the same turns
 * the live pipeline produces. Greeting-only chats (no user messages) get
 * a single null-opener extraction instead.
 *
 * Observations of other characters are no longer (only) per-turn: in the
 * `fold` / `hybrid` extraction modes most of them come from the fold-grain
 * OTHER pass. The regenerate resets the chat's fold-grain watermark and
 * enqueues one fold-grain catch-up so those rows are rebuilt too. It also
 * clears the episode pass's watermark, whose episodes the wipe removed.
 */

import { BackgroundJob, MessageEvent } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { retireChatMemories } from '@/lib/memory/retire';
import { enqueueMemoryExtraction } from '../queue-service';
import { logger } from '@/lib/logger';
import { getMemoryExtractionModeSettings } from '@/lib/instance-settings';
import type { MemoryRegenerateChatPayload } from '../queue-service';

export async function handleMemoryRegenerateChat(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as MemoryRegenerateChatPayload;
  const repos = getRepositories();

  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    // Orphaned memories: chat is gone, just wipe whatever is left and stop.
    const wipeResult = await retireChatMemories(payload.chatId);
    logger.info('[MemoryRegenerateChat] Chat no longer exists; deleted orphan memories', {
      jobId: job.id,
      chatId: payload.chatId,
      deleted: wipeResult.retired,
      spared: wipeResult.spared,
      vectorsRemoved: wipeResult.vectorsRemoved,
    });
    return;
  }

  // Verify the connection profile is still resolvable. If it's not, fail loud
  // rather than silently skipping all the extraction passes downstream.
  const connectionProfile = await repos.connections.findById(payload.connectionProfileId);
  if (!connectionProfile) {
    throw new Error(
      `Connection profile not found for memory regeneration: ${payload.connectionProfileId}`,
    );
  }

  const wipeResult = await retireChatMemories(payload.chatId);
  await rebuildFoldGrainObservations(job, payload, chat.otherExtractionWatermarkMessageId ?? null);
  await resetEpisodeWatermark(job, payload, chat.episodeExtractionWatermarkMessageId ?? null);

  const allRawMessages = await repos.chats.getMessages(payload.chatId);
  const messageEvents = allRawMessages.filter(
    (m): m is MessageEvent => m.type === 'message',
  ) as unknown as MessageEvent[];

  // Collect user-message turn openers in chronological order. System whispers
  // (Host, Librarian, etc.) wear role:'USER' in some places but always carry
  // a systemSender — skip them, mirroring findTurnOpenerMessageId().
  const turnOpenerIds: string[] = [];
  for (const m of messageEvents) {
    if (m.role !== 'USER') continue;
    if (m.systemSender) continue;
    turnOpenerIds.push(m.id);
  }

  // The chat's existing memories were just wiped, and no other path
  // enqueues extractions for a chat being regenerated mid-sweep, so the
  // dedup scan inside enqueueMemoryExtraction would just be a no-op that
  // costs two DB queries per opener. Skip it — on a 50-turn chat that's
  // 100 queries we don't need.
  if (turnOpenerIds.length === 0) {
    // Greeting-only chat: one null-opener extraction covers every assistant
    // message in the history.
    await enqueueMemoryExtraction(
      job.userId,
      {
        chatId: payload.chatId,
        turnOpenerMessageId: null,
        connectionProfileId: payload.connectionProfileId,
      },
      { skipDedupCheck: true },
    );
    logger.info('[MemoryRegenerateChat] Wiped chat and enqueued greeting extraction', {
      jobId: job.id,
      chatId: payload.chatId,
      deleted: wipeResult.retired,
      spared: wipeResult.spared,
      vectorsRemoved: wipeResult.vectorsRemoved,
      extractionsEnqueued: 1,
    });
    return;
  }

  for (const openerId of turnOpenerIds) {
    await enqueueMemoryExtraction(
      job.userId,
      {
        chatId: payload.chatId,
        turnOpenerMessageId: openerId,
        connectionProfileId: payload.connectionProfileId,
      },
      { skipDedupCheck: true },
    );
  }

  logger.info('[MemoryRegenerateChat] Wiped chat and enqueued per-turn extractions', {
    jobId: job.id,
    chatId: payload.chatId,
    deleted: wipeResult.retired,
    vectorsRemoved: wipeResult.vectorsRemoved,
    extractionsEnqueued: turnOpenerIds.length,
  });
}

/**
 * Reset the fold-grain OTHER watermark and enqueue one catch-up pass, so a
 * regenerate rebuilds the observations of others that the per-turn pass no
 * longer writes. No-op in `turn` mode, where the per-turn pass still writes
 * them all. The catch-up reads the chat's whole history in consecutive slices
 * of `FOLD_OTHER_MAX_WINDOW_MESSAGES`, advancing the watermark past each one
 * (bug 206), so the rebuilt observations cover the whole chat.
 */
async function rebuildFoldGrainObservations(
  job: BackgroundJob,
  payload: MemoryRegenerateChatPayload,
  previousWatermark: string | null,
): Promise<void> {
  const mode = await getMemoryExtractionModeSettings();
  if (mode.otherPass === 'turn') {
    logger.debug('[MemoryRegenerateChat] Extraction mode is per-turn; no fold-grain rebuild', {
      jobId: job.id,
      chatId: payload.chatId,
    });
    return;
  }

  const repos = getRepositories();
  if (previousWatermark) {
    await repos.chats.update(payload.chatId, { otherExtractionWatermarkMessageId: null });
  }
  await enqueueMemoryExtraction(
    job.userId,
    {
      chatId: payload.chatId,
      turnOpenerMessageId: null,
      extractionAnchorMessageId: `regenerate:${job.id}`,
      connectionProfileId: payload.connectionProfileId,
      foldOtherCatchup: true,
      foldOtherIgnoreIdle: true,
    },
    { skipDedupCheck: true },
  );
  logger.debug('[MemoryRegenerateChat] Reset fold-grain watermark and enqueued catch-up', {
    jobId: job.id,
    chatId: payload.chatId,
    previousWatermark,
    otherPass: mode.otherPass,
  });
}

/**
 * The wipe removed the chat's episode memories too, so the fold-time episode
 * pass's watermark no longer marks anything it wrote. Clearing it lets the
 * next hard-rebuild fold read the history again, in slices, and rebuild the
 * episodes (bug 207). Independent of the extraction mode: the episode pass
 * runs in every mode.
 */
async function resetEpisodeWatermark(
  job: BackgroundJob,
  payload: MemoryRegenerateChatPayload,
  previousWatermark: string | null,
): Promise<void> {
  if (!previousWatermark) return;
  await getRepositories().chats.update(payload.chatId, { episodeExtractionWatermarkMessageId: null });
  logger.debug('[MemoryRegenerateChat] Reset episode watermark', {
    jobId: job.id,
    chatId: payload.chatId,
    previousWatermark,
  });
}
