/**
 * Migration: re-index chat-message search without the Staff
 *
 * `create-chat-message-fts-v1` indexed every `type='message'` row with role
 * `USER` or `ASSISTANT`. Staff messages — Commonplace Book recall whispers,
 * Host, Prospero and Librarian announcements — are written with role
 * `ASSISTANT`, so they were indexed too, and global search returned them as
 * though a character had said them (#121). Announcement bubbles
 * (`customAnnouncer`) had the same problem.
 *
 * The eligibility rule in `lib/database/backends/sqlite/chat-message-fts.ts`
 * now excludes both. That module's `ensureChatMessageFtsSchema` replaces the
 * insert trigger when its stored definition no longer matches, and this
 * migration then rebuilds the index so the rows already in it are dropped.
 * The startup reconcile would reach the same end state on its own; running it
 * here puts the rebuild behind the loading screen, with progress.
 *
 * REVERSIBLE in the same sense as the index itself: it stores no message text,
 * and a rebuild under any rule reproduces it.
 *
 * Migration ID: reindex-chat-message-fts-character-only-v1
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
  staleChatMessageFtsTriggers,
} from '@/lib/database/backends/sqlite/chat-message-fts';

const MIGRATION_ID = 'reindex-chat-message-fts-character-only-v1';

export const reindexChatMessageFtsCharacterOnlyMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Rebuild the chat-message search index without Staff messages or announcement bubbles',
  introducedInVersion: '4.12.0',
  dependsOn: [
    'create-chat-message-fts-v1',
    'add-system-sender-field-v1',
    'add-custom-announcer-field-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chat_messages')) return false;
    const db = getSQLiteDatabase();

    if (missingChatMessageFtsObjects(db).length > 0) return true;
    if (staleChatMessageFtsTriggers(db).length > 0) return true;
    return countEligibleChatMessages(db) !== countIndexedChatMessages(db);
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const db = getSQLiteDatabase();

    const stale = staleChatMessageFtsTriggers(db);
    const before = countIndexedChatMessages(db);
    ensureChatMessageFtsSchema(db);

    logger.info('Rebuilding chat message search index without Staff messages', {
      context: 'migrations.reindex-chat-message-fts-character-only',
      replacedTriggers: stale,
      indexedBefore: before,
    });

    const { scanned, indexed, total } = rebuildChatMessageFtsIndex(db, (done, all) => {
      reportProgress(done, all, 'messages');
    });
    const dropped = Math.max(0, before - indexed);

    logger.info('Chat message search index rebuilt', {
      context: 'migrations.reindex-chat-message-fts-character-only',
      scanned,
      indexed,
      total,
      dropped,
    });

    return {
      id: MIGRATION_ID,
      success: true,
      itemsAffected: dropped,
      message:
        dropped > 0
          ? `Removed ${dropped} Staff message${dropped === 1 ? '' : 's'} from the search index`
          : 'No Staff messages were in the search index',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
