/**
 * Migration: build the chat-message full-text search index
 *
 * Global message search was `content LIKE '%…%'` with no index that could
 * serve it — a full scan of 355 MB on the reference instance, 55 ms a query.
 * That scan was also the one thing keeping `chat_messages.content` from being
 * stored brotli-compressed, since a compressed BLOB cannot be `LIKE`-matched.
 *
 * This creates the contentless FTS5 index, its id-mapping table and the three
 * sync triggers, then populates the index from the existing transcript. The
 * DDL itself lives in `lib/database/backends/sqlite/chat-message-fts.ts` — the
 * single source of truth that this migration, the startup guard and any future
 * CLI verb all share.
 *
 * Created HERE rather than in `ensureCollection`: that path only runs the
 * Zod-derived `CREATE TABLE IF NOT EXISTS` and knows nothing of triggers or
 * virtual tables. A fresh instance gets `chat_messages` from
 * `sqlite-initial-schema-v1`, so a fresh install and an upgrade take the same
 * path through here.
 *
 * REVERSIBLE: this stores no message text of its own — dropping the two tables
 * and three triggers returns the database to exactly where it was. The index
 * costs roughly 133 MB on the reference instance and is paid for ~2.4× over by
 * the compression it unblocks (`compress-chat-message-text-v1`).
 *
 * Migration ID: create-chat-message-fts-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import { isSQLiteBackend, getSQLiteDatabase, sqliteTableExists } from '../lib/database-utils';
import {
  countEligibleChatMessages,
  countIndexedChatMessages,
  ensureChatMessageFtsSchema,
  missingChatMessageFtsObjects,
  rebuildChatMessageFtsIndex,
} from '@/lib/database/backends/sqlite/chat-message-fts';

const MIGRATION_ID = 'create-chat-message-fts-v1';

export const createChatMessageFtsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Create the FTS5 index behind global chat-message search',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chat_messages')) return false;
    const db = getSQLiteDatabase();

    // Any missing table or trigger, or an index that disagrees with the
    // transcript, means there is work to do.
    if (missingChatMessageFtsObjects(db).length > 0) return true;
    return countEligibleChatMessages(db) !== countIndexedChatMessages(db);
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const db = getSQLiteDatabase();

    const missing = missingChatMessageFtsObjects(db);
    ensureChatMessageFtsSchema(db);

    logger.info('Building chat message search index', {
      context: 'migrations.create-chat-message-fts',
      created: missing,
    });

    const { scanned, indexed, total } = rebuildChatMessageFtsIndex(db, (done, all) => {
      reportProgress(done, all, 'messages');
    });

    logger.info('Chat message search index built', {
      context: 'migrations.create-chat-message-fts',
      scanned,
      indexed,
      total,
    });

    return {
      id: MIGRATION_ID,
      success: true,
      itemsAffected: indexed,
      message:
        indexed > 0
          ? `Indexed ${indexed} message${indexed === 1 ? '' : 's'} for search`
          : 'No messages needed indexing',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
