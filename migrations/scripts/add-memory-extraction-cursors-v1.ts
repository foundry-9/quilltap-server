/**
 * Migration: memory extraction cursors (memory refactor Phase D).
 *
 * Creates `memory_extraction_cursors` — one row per (chat, fold-grain pass),
 * the last message that pass has read — and moves the two per-chat watermark
 * columns into it:
 *
 *   chats.otherExtractionWatermarkMessageId   → pass 'other-fold'
 *   chats.episodeExtractionWatermarkMessageId → pass 'episode-fold'
 *
 * Then drops both columns. No index, trigger or view names them, so a plain
 * `ALTER TABLE … DROP COLUMN` is enough. Old `.qtap` bundles and backups still
 * carry the two fields on the chat; import and restore turn them into cursors
 * (`lib/memory/extraction/cursor-bundle.ts`).
 *
 * Migration ID: add-memory-extraction-cursors-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-memory-extraction-cursors-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

/** Legacy column → the pass whose cursor it becomes. */
export const LEGACY_WATERMARK_COLUMNS: ReadonlyArray<{ column: string; pass: 'other-fold' | 'episode-fold' }> = [
  { column: 'otherExtractionWatermarkMessageId', pass: 'other-fold' },
  { column: 'episodeExtractionWatermarkMessageId', pass: 'episode-fold' },
];

export const addMemoryExtractionCursorsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Create memory_extraction_cursors; move the fold-pass watermarks off chats and drop the columns',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-memory-tiers-v1', 'add-episode-extraction-watermark-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chats')) return false;
    if (!sqliteTableExists('memory_extraction_cursors')) return true;
    return LEGACY_WATERMARK_COLUMNS.some(({ column }) => sqliteColumnExists('chats', column));
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();

      db.exec(
        `CREATE TABLE IF NOT EXISTS "memory_extraction_cursors" (
          "id" TEXT PRIMARY KEY,
          "chatId" TEXT NOT NULL,
          "pass" TEXT NOT NULL,
          "messageId" TEXT NOT NULL,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          UNIQUE ("chatId", "pass"),
          FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE
        )`,
      );
      logger.info('memory_extraction_cursors table in place', { context: LOG_CONTEXT });

      const present = LEGACY_WATERMARK_COLUMNS.filter(({ column }) => sqliteColumnExists('chats', column));
      const insert = db.prepare(
        `INSERT INTO "memory_extraction_cursors" ("id", "chatId", "pass", "messageId", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT("id") DO NOTHING`,
      );
      const now = new Date().toISOString();
      let backfilled = 0;

      for (const { column, pass } of present) {
        const rows = db
          .prepare(`SELECT "id", "${column}" AS "messageId" FROM "chats" WHERE "${column}" IS NOT NULL AND "${column}" <> ''`)
          .all() as Array<{ id: string; messageId: string }>;
        const copy = db.transaction(() => {
          for (let i = 0; i < rows.length; i++) {
            const result = insert.run(`${rows[i].id}:${pass}`, rows[i].id, pass, rows[i].messageId, now, now);
            backfilled += result.changes;
          }
        });
        copy();
        reportProgress(rows.length, rows.length, `${pass} cursors`);
        logger.info('Copied watermark column into cursors', { context: LOG_CONTEXT, column, pass, rows: rows.length });
      }
      itemsAffected += backfilled;

      for (const { column } of present) {
        db.exec(`ALTER TABLE "chats" DROP COLUMN "${column}"`);
        logger.info(`Dropped chats.${column}`, { context: LOG_CONTEXT });
      }

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Extraction cursors in place (${backfilled} carried over from ${present.length} watermark column(s))`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Extraction-cursor migration failed', { context: LOG_CONTEXT, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected,
        message: `Extraction-cursor migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
