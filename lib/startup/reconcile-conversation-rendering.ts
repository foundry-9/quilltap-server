/**
 * Conversation render/embed reconciliation (startup self-heal)
 *
 * Re-enqueues a CONVERSATION_RENDER job for every chat the Scriptorium pipeline
 * left half-finished:
 *
 *   (A) a chat with real USER/ASSISTANT messages but no rendered Markdown — the
 *       per-turn render trigger never fired or the render job died (e.g. an
 *       interrupted shutdown), so `renderedMarkdown` is still NULL; or
 *   (B) a chat whose interchange chunks were never embedded — the embedding
 *       provider was down when the turn fired (Ollama/cloud outage), or the
 *       render job died before enqueuing the embeds, leaving chunks with a NULL
 *       `embedding` blob ("yellow" in the chat list) and no recovery path.
 *
 * Re-running CONVERSATION_RENDER heals both: the render handler upserts the
 * interchange chunks (preserving any embeddings already present) and re-enqueues
 * EMBEDDING_GENERATE for every chunk still lacking one.
 *
 * Why every startup (not a one-time backfill): the gap recurs. New chats slip
 * through whenever the embedder is unavailable mid-conversation, and a hard
 * shutdown can drop an in-flight render. So this is a recurring safety net. It
 * is a no-op on a healthy instance — one indexed scan that returns nothing and
 * enqueues nothing.
 *
 * Why ENQUEUE rather than render inline: a large backlog must not block the
 * startup loading screen, and `enqueueConversationRender` already dedupes
 * against any render job still pending for the chat, so repeated boots before
 * the queue drains can't pile up duplicate work.
 *
 * Oversized / empty chunks are EXCLUDED from the "needs work" test. A chunk
 * larger than {@link EMBEDDING_MAX_CHARS} (or empty) is deterministically
 * unembeddable today — the embedder marks it FAILED without retry, and oversized
 * interchanges await renderer-side sub-chunking. Counting them would keep their
 * chat perpetually "incomplete" and re-render it on every boot for nothing.
 *
 * Runs in the parent (the sole DB writer), like the other startup self-heals,
 * so the enqueue writes land directly rather than buffering through the job
 * child.
 *
 * @module startup/reconcile-conversation-rendering
 */
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { enqueueConversationRender } from '@/lib/background-jobs/queue-service';
import { EMBEDDING_MAX_CHARS } from '@/lib/embedding/embedding-service';

const logger = createServiceLogger('Startup:ConversationRenderReconcile');

/**
 * Chats that are not fully rendered + embedded, excluding chunks that can never
 * embed (oversized / empty). The `?` binds {@link EMBEDDING_MAX_CHARS}.
 */
const SELECT_INCOMPLETE_CHATS = `
  SELECT c."id" AS chatId, c."userId" AS userId
  FROM "chats" c
  WHERE (
    -- (A) Real messages but never rendered to Markdown.
    c."renderedMarkdown" IS NULL
    AND EXISTS (
      SELECT 1 FROM "chat_messages" m
      WHERE m."chatId" = c."id"
        AND m."type" = 'message'
        AND m."role" IN ('USER', 'ASSISTANT')
    )
  ) OR EXISTS (
    -- (B) At least one recoverable un-embedded interchange chunk
    --     (non-empty and within the embedder's size cap).
    SELECT 1 FROM "conversation_chunks" cc
    WHERE cc."chatId" = c."id"
      AND cc."embedding" IS NULL
      AND LENGTH(cc."content") BETWEEN 1 AND ?
  )
`;

export interface ConversationRenderReconcileResult {
  /** Distinct chats found to be incomplete. */
  incompleteChats: number;
  /** New render jobs enqueued. */
  enqueued: number;
  /** Chats that already had a render job pending (deduped). */
  reused: number;
  /** Chats whose enqueue threw (logged, sweep continues). */
  failed: number;
}

interface IncompleteChatRow {
  chatId: string;
  userId: string;
}

/**
 * Scan for half-rendered / un-embedded conversations and re-enqueue a render
 * for each. Safe to call on every startup; idempotent and a no-op when every
 * conversation is already fully rendered and embedded.
 */
export async function reconcileConversationRendering(): Promise<ConversationRenderReconcileResult> {
  const result: ConversationRenderReconcileResult = {
    incompleteChats: 0,
    enqueued: 0,
    reused: 0,
    failed: 0,
  };

  const db = getRawDatabase();
  if (!db) {
    logger.debug('No SQLite database available; skipping conversation render reconciliation');
    return result;
  }

  let rows: IncompleteChatRow[];
  try {
    rows = db.prepare(SELECT_INCOMPLETE_CHATS).all(EMBEDDING_MAX_CHARS) as IncompleteChatRow[];
  } catch (err) {
    logger.warn('Failed to scan for incomplete conversations; skipping reconciliation', {
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  result.incompleteChats = rows.length;
  if (rows.length === 0) {
    return result;
  }

  logger.info('Conversation render reconciliation: found incomplete conversations', {
    count: rows.length,
  });

  for (const row of rows) {
    try {
      const { isNew } = await enqueueConversationRender(row.userId, { chatId: row.chatId });
      if (isNew) {
        result.enqueued++;
      } else {
        result.reused++;
      }
    } catch (err) {
      result.failed++;
      logger.warn('Failed to enqueue conversation render during reconciliation', {
        chatId: row.chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Yield between enqueues so a large backlog can't hog the event loop while
    // the rest of startup is still settling.
    await new Promise(resolve => setImmediate(resolve));
  }

  logger.info('Conversation render reconciliation complete', {
    incompleteChats: result.incompleteChats,
    enqueued: result.enqueued,
    reused: result.reused,
    failed: result.failed,
  });

  return result;
}
