/**
 * Chat-message FTS reconciliation (startup self-heal)
 *
 * The message search index (`lib/database/backends/sqlite/chat-message-fts.ts`)
 * is maintained by triggers, which is what makes it impossible for a new write
 * path to bypass. It is not, however, impossible for the SCHEMA to go missing:
 *
 *  - Any table rebuild of `chat_messages` — the
 *    `CREATE new … INSERT … SELECT … DROP … RENAME` pattern several migrations
 *    use on other tables — reassigns every rowid and **silently drops the
 *    triggers with the old table**. No error is raised; the index simply stops
 *    being updated, and search quietly goes stale.
 *  - A restore or a hand-repaired database can arrive without the objects at
 *    all.
 *
 * That is the one silent failure mode in the design, so this turns it into a
 * self-healing one. Every boot:
 *
 *  1. Replay the `IF NOT EXISTS` DDL — a no-op on a healthy instance, and the
 *     thing that puts dropped triggers back.
 *  2. Compare eligible `chat_messages` rows against `chat_messages_fts_map`
 *     rows. Two counts on indexed columns; cheap enough to run unconditionally.
 *  3. On a mismatch, log at `warn` and rebuild.
 *
 * Runs in the parent (the sole DB writer), like the other startup self-heals.
 *
 * @module startup/reconcile-chat-message-fts
 */
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import {
  countEligibleChatMessages,
  countIndexedChatMessages,
  ensureChatMessageFtsSchema,
  missingChatMessageFtsObjects,
  rebuildChatMessageFtsIndex,
} from '@/lib/database/backends/sqlite/chat-message-fts';

const logger = createServiceLogger('Startup:ChatMessageFtsReconcile');

export interface ChatMessageFtsReconcileResult {
  /** Schema objects that had to be (re)created. */
  restored: string[];
  /** Eligible `chat_messages` rows. */
  eligible: number;
  /** Rows the index actually held before any rebuild. */
  indexed: number;
  /** Whether a full rebuild ran. */
  rebuilt: boolean;
}

/**
 * Ensure the message search index exists and is in step with the transcript.
 *
 * Idempotent and a no-op on a healthy instance.
 */
export async function reconcileChatMessageFts(): Promise<ChatMessageFtsReconcileResult> {
  const result: ChatMessageFtsReconcileResult = {
    restored: [],
    eligible: 0,
    indexed: 0,
    rebuilt: false,
  };

  const db = getRawDatabase();
  if (!db) {
    logger.debug('No SQLite database available; skipping chat message FTS reconciliation');
    return result;
  }

  try {
    result.restored = missingChatMessageFtsObjects(db);
    if (result.restored.length > 0) {
      logger.warn('Message search index objects were missing; recreating', {
        missing: result.restored,
      });
    }
    ensureChatMessageFtsSchema(db);

    result.eligible = countEligibleChatMessages(db);
    result.indexed = countIndexedChatMessages(db);
    logger.debug('Message search index counts', {
      eligible: result.eligible,
      indexed: result.indexed,
    });

    if (result.eligible !== result.indexed) {
      logger.warn('Message search index is out of step with the transcript; rebuilding', {
        eligible: result.eligible,
        indexed: result.indexed,
      });
      const rebuild = rebuildChatMessageFtsIndex(db);
      result.rebuilt = true;
      logger.info('Message search index rebuilt', {
        indexed: rebuild.indexed,
        durationMs: rebuild.durationMs,
      });
    }
  } catch (err) {
    // A broken index must never keep the instance from starting: search
    // degrades to the exact-scan fallback, which is slow but correct.
    logger.warn('Chat message FTS reconciliation failed; search may be degraded', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}
