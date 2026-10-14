/**
 * Migration: the fold-time episode pass gets a watermark (bug 207).
 *
 * Adds `chats.episodeExtractionWatermarkMessageId` (TEXT, default NULL): the
 * last message the fold-time episode pass has read. A hard-rebuild fold hands
 * the pass turns 1..N; without a watermark it re-extracted episodes over the
 * whole history every 50 turns.
 *
 * Backfill: every fold so far ran the episode pass over its own window, and
 * `summaryAnchorMessageIds` lists every conversation message in the turns the
 * summary has folded, chronologically. Its last entry is therefore where the
 * episode pass has read up to, and becomes the watermark. A chat with no
 * anchors (never folded, or its summary was cleared) stays NULL — the next
 * fold reads its window as before.
 *
 * Migration ID: add-episode-extraction-watermark-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-episode-extraction-watermark-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
const COLUMN = 'episodeExtractionWatermarkMessageId';

/** The last id of a stored `summaryAnchorMessageIds` value, or null. */
export function lastSummaryAnchor(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const last = parsed[parsed.length - 1];
    return typeof last === 'string' && last.length > 0 ? last : null;
  } catch {
    return null;
  }
}

export const addEpisodeExtractionWatermarkMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Add chats.episodeExtractionWatermarkMessageId (fold-time episode pass watermark), backfilled from the summary anchors',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-memory-tiers-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chats')) return false;
    return !sqliteColumnExists('chats', COLUMN);
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();

      if (addColumnIfMissing('chats', COLUMN, 'TEXT DEFAULT NULL')) {
        itemsAffected++;
        logger.info(`Added chats.${COLUMN} column`, { context: LOG_CONTEXT });
      }

      let backfilled = 0;
      if (sqliteColumnExists('chats', 'summaryAnchorMessageIds')) {
        const rows = db
          .prepare(
            `SELECT id, summaryAnchorMessageIds FROM chats
              WHERE ${COLUMN} IS NULL
                AND summaryAnchorMessageIds IS NOT NULL
                AND summaryAnchorMessageIds NOT IN ('', '[]')`,
          )
          .all() as Array<{ id: string; summaryAnchorMessageIds: unknown }>;
        const update = db.prepare(`UPDATE chats SET ${COLUMN} = ? WHERE id = ?`);
        for (let i = 0; i < rows.length; i++) {
          const watermark = lastSummaryAnchor(rows[i].summaryAnchorMessageIds);
          if (watermark) {
            update.run(watermark, rows[i].id);
            backfilled++;
          }
          reportProgress(i + 1, rows.length, 'chats');
        }
        logger.info('Backfilled episode watermarks from summary anchors', {
          context: LOG_CONTEXT,
          candidates: rows.length,
          backfilled,
        });
      }
      itemsAffected += backfilled;

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Episode watermark in place (${backfilled} chats backfilled)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Episode-watermark migration failed', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected,
        message: `Episode-watermark migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
