/**
 * Stale-chat cache collapse
 *
 * When a chat has gone quiet (no *played* message for the configured
 * retention window — see `resolveStaleChatDays`), the regenerable and
 * discardable working data it accumulated is dead weight:
 *
 *  - `chats.compressionCache`      — pre-compression cache; documented as
 *    regenerable with a synchronous-recompute fallback.
 *  - `chats.compiledIdentityStacks` — precompiled per-participant identity
 *    stacks; a read-through cache stamped with `IDENTITY_STACK_BUILDER_VERSION`
 *    whose miss path (`buildSystemPrompt`) rebuilds from the character's own
 *    fields. A stale entry is already discarded wholesale on a version bump,
 *    so clearing it costs one recompile on the chat's next turn.
 *  - `chat_messages.rawResponse`   — byte-exact provider payload; only read
 *    by generation-time services (failover/finalizer/regenerate), never by
 *    the historical read/render path.
 *  - `chat_messages.reasoningContent` / `reasoningSegments` — model thinking
 *    traces; DISPLAY ONLY, never re-fed to models.
 *  - `chat_messages.renderedHtml`  — pre-rendered HTML; the chat GET path
 *    re-renders from `content` live.
 *  - `chat_messages.debugMemoryLogs` — memory-gate debug telemetry.
 *
 * `conversation_chunks` embeddings are deliberately NEVER touched here. They
 * were once cold-tiered (NULLed) alongside these caches, but measurement on a
 * real instance showed the entire embedding corpus costs on the order of ~16
 * MB in a multi-hundred-MB database, while cold-tiering silently killed
 * semantic retrieval over the great majority of the user's conversation
 * history. A stale chat is otherwise-ordinary for embedding purposes — its
 * chunks stay warm and searchable for as long as they exist.
 *
 * NEVER touched: `content` (authoritative display text), `opaqueContent`
 * (real semantic body used in context builds), `thoughtSignature` (provider
 * continuation token, tiny), `attachments`, `contextSummary`, `chats.state`,
 * memories, `summaryAnchor`, and (as above) `conversation_chunks.embedding`.
 *
 * Gated on CHAT staleness via the same exported `forEachStaleChat` / `isStale`
 * walk the asset collapse uses, so the sweeps can never disagree on "stale". An active chat is never
 * touched. NULLing frees pages inside the file; actual file shrink happens at
 * the periodic manual `npx quilltap db optimize` (VACUUM).
 *
 * Runs on the parent process (the only DB writer), invoked inline by the
 * maintenance scheduler like the asset collapse.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { rawQuery } from '@/lib/database/manager';
import { dropInMemoryCompressionCache } from '@/lib/services/chat-message/compression-cache.service';
import type { ChatMetadata } from '@/lib/schemas/types';
import { forEachStaleChat } from './collapse-stale-chat-assets';
import { resolveStaleChatDays, retentionCutoff } from './retention-constants';

const moduleLogger = logger.child({ module: 'maintenance.collapse-stale-chat-caches' });

export interface StaleChatCacheCollapseSummary {
  /** Total chats examined. */
  chatsScanned: number;
  /** Chats found stale (eligible for collapse). */
  staleChats: number;
  /** Stale chats where at least one column/row was actually cleared. */
  chatsCollapsed: number;
  /** `chats` rows whose regenerable cache columns were cleared. */
  chatRowsCleared: number;
  /** `chat_messages` rows that had at least one discardable column cleared. */
  messageRowsCleared: number;
}

interface RunResultLike {
  changes?: number | bigint;
}

/**
 * Collapse one stale chat's regenerable caches. Idempotent: every UPDATE is
 * guarded by `IS NOT NULL` checks, so a second pass rewrites nothing.
 */
async function collapseOneChat(
  chat: ChatMetadata,
): Promise<{ chatRows: number; messageRows: number }> {
  // 1. `chats` columns. Raw SQL (not repos.chats.update) so the chat's
  //    updatedAt is NOT bumped — a maintenance pass must never make a stale
  //    chat look freshly touched. The in-memory compression cache is dropped
  //    alongside so the service can't serve a stale entry it believes is
  //    still persisted.
  const chatResult = await rawQuery<RunResultLike>(
    `UPDATE chats
        SET compressionCache = NULL, compiledIdentityStacks = NULL
      WHERE id = ?
        AND (compressionCache IS NOT NULL OR compiledIdentityStacks IS NOT NULL)`,
    [chat.id],
  );
  const chatRows = Number(chatResult?.changes ?? 0);
  dropInMemoryCompressionCache(chat.id);

  // 2. `chat_messages` discardable columns, one guarded UPDATE per chat.
  const messageResult = await rawQuery<RunResultLike>(
    `UPDATE chat_messages
        SET rawResponse = NULL, reasoningContent = NULL, reasoningSegments = NULL,
            renderedHtml = NULL, debugMemoryLogs = NULL
      WHERE chatId = ?
        AND (rawResponse IS NOT NULL OR reasoningContent IS NOT NULL
          OR reasoningSegments IS NOT NULL OR renderedHtml IS NOT NULL
          OR debugMemoryLogs IS NOT NULL)`,
    [chat.id],
  );
  const messageRows = Number(messageResult?.changes ?? 0);

  if (chatRows > 0 || messageRows > 0) {
    moduleLogger.info('Collapsed stale chat caches', {
      chatId: chat.id,
      chatRows,
      messageRows,
    });
  }

  return { chatRows, messageRows };
}

/**
 * Collapse every stale chat's regenerable caches. Each chat is processed
 * independently so one failure cannot abort the rest.
 */
export async function collapseStaleChatCaches(
  now: number = Date.now(),
): Promise<StaleChatCacheCollapseSummary> {
  const repos = getRepositories();
  const cutoffMs = retentionCutoff(await resolveStaleChatDays(), now).getTime();

  const summary: StaleChatCacheCollapseSummary = {
    chatsScanned: 0,
    staleChats: 0,
    chatsCollapsed: 0,
    chatRowsCleared: 0,
    messageRowsCleared: 0,
  };

  const { chatsScanned, staleChats } = await forEachStaleChat(
    repos,
    cutoffMs,
    async (chat) => {
      const { chatRows, messageRows } = await collapseOneChat(chat);
      if (chatRows > 0 || messageRows > 0) {
        summary.chatsCollapsed++;
        summary.chatRowsCleared += chatRows;
        summary.messageRowsCleared += messageRows;
      }
    },
    (chat, error) => {
      moduleLogger.warn('Failed to collapse stale chat caches — continuing', {
        chatId: chat.id,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );
  summary.chatsScanned = chatsScanned;
  summary.staleChats = staleChats;

  moduleLogger.info('Stale-chat cache collapse complete', { ...summary });
  return summary;
}
