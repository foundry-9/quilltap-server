/**
 * Regenerate Conversation Summaries — Backfill Job Handler
 *
 * The HTTP endpoint POST /api/v1/system/conversation-summaries?action=regenerate
 * enqueues exactly one of these and returns immediately. This handler then walks
 * every chat the user owns that carries a context summary and re-mirrors that
 * summary into each participant character's vault under "Conversation Summaries/"
 * via the existing bridge — a backfill for the files the Commonplace Book's
 * relevant-conversations retrieval depends on, and a repair after the summary
 * format changes.
 *
 * The work is idempotent (the bridge replaces a conversation's prior file by
 * its frontmatter UUID) and best-effort per chat: one bad chat never aborts the
 * rest. `writeConversationSummaryToVaults` short-circuits to the parent via
 * host-RPC when running inside this forked child, so the documents commit on the
 * RW connection like every other fold write.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import {
  writeConversationSummaryToVaults,
  computeConversationStats,
} from '@/lib/file-storage/conversation-summary-vault-bridge';
import { logger } from '@/lib/logger';

export async function handleRegenerateConversationSummaries(job: BackgroundJob): Promise<void> {
  const repos = getRepositories();

  const userChats = await repos.chats.findByUserId(job.userId);
  const summarized = userChats.filter(
    (c) => typeof c.contextSummary === 'string' && c.contextSummary.trim().length > 0,
  );

  let mirrored = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();

  for (const chat of summarized) {
    try {
      const participantCharacterIds = Array.from(
        new Set(chat.participants.map((p) => p.characterId)),
      );
      if (participantCharacterIds.length === 0) continue;

      const allChatMessages = await repos.chats.getMessages(chat.id);
      const stats = computeConversationStats(allChatMessages);

      await writeConversationSummaryToVaults({
        chatId: chat.id,
        chatTitle: chat.title,
        summary: chat.contextSummary as string,
        summaryGeneration: chat.compactionGeneration ?? 0,
        participantCharacterIds,
        messageCount: stats.messageCount,
        firstMessageAt: stats.firstMessageAt,
        lastMessageAt: stats.lastMessageAt,
        updatedAt: nowIso,
      });
      mirrored++;
    } catch (error) {
      failed++;
      logger.warn('[RegenerateConversationSummaries] Failed to re-mirror a chat summary', {
        chatId: chat.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('[RegenerateConversationSummaries] Backfill complete', {
    jobId: job.id,
    userId: job.userId,
    summarizedChats: summarized.length,
    mirrored,
    failed,
  });
}
