/**
 * Memory Regenerate Chat Job Handler
 *
 * Wipes every memory tied to one chat (`retireChatMemories`, which spares
 * MANUAL rows, cold rows and digests with a surviving member) and rebuilds
 * them through the extraction pipeline:
 *
 *  - one MEMORY_EXTRACTION turn job per turn (`listExtractionTurns`: one per
 *    USER opener; one per closing ASSISTANT line in an autonomous room; one
 *    null-opener job for a greeting-only chat), so the rebuilt turns tile the
 *    chat exactly as the live pipeline does;
 *  - both fold passes' cursors cleared, so their rows (removed by the wipe)
 *    are rebuilt from the chat's start: an `other-fold` catch-up is enqueued
 *    now (in the `fold` / `hybrid` modes, where it owns the observations of
 *    others), and an `episode-fold` catch-up over the folded history.
 *
 * Each catch-up reads its backlog in slices, advancing its cursor past each
 * and enqueuing its own successor, so the rebuilt fold-grain rows cover the
 * whole history (bug 206).
 */

import { BackgroundJob, MessageEvent } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { retireChatMemories } from '@/lib/memory/retire';
import { listExtractionTurns } from '@/lib/services/chat-message/turn-transcript';
import { getMemoryExtractionModeSettings } from '@/lib/instance-settings';
import { enqueueMemoryExtraction } from '../queue-service';
import { logger } from '@/lib/logger';
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
  const clearedCursors = await repos.memoryExtractionCursors.clearForChat(payload.chatId);
  logger.debug('[MemoryRegenerateChat] Cleared extraction cursors', {
    jobId: job.id,
    chatId: payload.chatId,
    clearedCursors,
  });

  const messages = (await repos.chats.getMessages(payload.chatId)).filter(
    (m): m is MessageEvent => m.type === 'message',
  ) as unknown as MessageEvent[];
  const turns = listExtractionTurns(messages, chat.chatType);

  // The wipe removed this chat's rows, and nothing else enqueues extractions
  // for a chat mid-regenerate, so the per-opener dedupe scan would only cost
  // two queries a turn.
  for (const turn of turns) {
    await enqueueMemoryExtraction(
      job.userId,
      {
        chatId: payload.chatId,
        turnOpenerMessageId: turn.turnOpenerMessageId,
        extractionAnchorMessageId: turn.extractionAnchorMessageId ?? null,
        connectionProfileId: payload.connectionProfileId,
        backfill: true,
      },
      { skipDedupCheck: true },
    );
  }

  const mode = await getMemoryExtractionModeSettings();
  const catchups: Array<'other-fold' | 'episode-fold'> =
    mode.otherPass === 'turn' ? ['episode-fold'] : ['other-fold', 'episode-fold'];
  for (const pass of catchups) {
    await enqueueMemoryExtraction(
      job.userId,
      {
        chatId: payload.chatId,
        turnOpenerMessageId: null,
        extractionAnchorMessageId: `regenerate:${job.id}`,
        connectionProfileId: payload.connectionProfileId,
        pass,
        ignoreIdle: true,
        backfill: true,
      },
      { skipDedupCheck: true },
    );
  }

  logger.info('[MemoryRegenerateChat] Wiped chat and enqueued its rebuild', {
    jobId: job.id,
    chatId: payload.chatId,
    chatType: chat.chatType ?? null,
    deleted: wipeResult.retired,
    spared: wipeResult.spared,
    vectorsRemoved: wipeResult.vectorsRemoved,
    turnJobs: turns.length,
    catchups,
  });
}
