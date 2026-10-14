/**
 * Migration: Drop the Stored Scriptorium Transcript Column
 *
 * `chats.renderedMarkdown` held a full Markdown rendering of every chat — a
 * deterministic function of its messages, averaging ~160 KB a chat. Because
 * chat rows are always read whole, every chat list, `findAll` and
 * `findByCharacterId` carried every transcript along with it. The stale-chat
 * sweep hid the cost by NULLing it for quiet chats, which in turn left those
 * chats unreadable through `read_conversation`.
 *
 * The transcript is now rendered on demand (`lib/scriptorium/render-chat.ts`)
 * and the Scriptorium status is derived from the interchange chunks alone
 * (`lib/scriptorium/status.ts`), so nothing reads or writes the column.
 *
 * No index, trigger or view names the column, so a plain
 * `ALTER TABLE ... DROP COLUMN` is enough (SQLite 3.35+; better-sqlite3
 * bundles 3.45+). Old `.qtap` bundles and backups that still carry the field
 * are unaffected: the chat schema no longer declares it, so it is stripped on
 * import. Dropping it only frees pages inside the file — run
 * `npx quilltap db optimize` afterwards to shrink it.
 *
 * Migration ID: drop-chat-rendered-markdown-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
} from '../lib/database-utils';

const MIGRATION_ID = 'drop-chat-rendered-markdown-v1';

export const dropChatRenderedMarkdownMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Drop chats.renderedMarkdown; transcripts are rendered on demand',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-rendered-markdown-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('chats')) {
      return false;
    }
    return sqliteColumnExists('chats', 'renderedMarkdown');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      const { n, bytes } = db
        .prepare(
          `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH("renderedMarkdown")), 0) AS bytes
             FROM "chats" WHERE "renderedMarkdown" IS NOT NULL`,
        )
        .get() as { n: number; bytes: number };

      logger.debug('Dropping the stored renderedMarkdown column from chats', {
        context: 'migration.drop-chat-rendered-markdown',
        renderedChats: n,
        bytes,
      });

      db.exec('ALTER TABLE "chats" DROP COLUMN "renderedMarkdown"');

      const durationMs = Date.now() - startTime;
      const mb = (bytes / 1048576).toFixed(1);
      logger.info('Dropped the stored renderedMarkdown column from chats', {
        context: 'migration.drop-chat-rendered-markdown',
        renderedChats: n,
        bytes,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: n,
        message:
          `Dropped chats.renderedMarkdown (${n} stored transcript${n === 1 ? '' : 's'}, ${mb} MB). ` +
          `Run 'npx quilltap db optimize' to shrink the file.`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to drop the renderedMarkdown column', {
        context: 'migration.drop-chat-rendered-markdown',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to drop chats.renderedMarkdown',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
