/**
 * Migration: Memory tiers and consolidation bookkeeping.
 *
 * The Commonplace Book could append, reinforce, link and delete, but never
 * combine — and its only lever under cap pressure was deletion. This
 * migration gives it a cellar:
 *
 *  - memories.tier              TEXT  — 'hot' (default) | 'cold'
 *  - memories.supersededById    TEXT  — the digest that replaced this row
 *  - memories.consolidatedFrom  TEXT  — digest rows: JSON string[] of member ids
 *  - memories.consolidatedAt    TEXT  — last time the consolidator considered the row
 *  - index (characterId, tier)
 *  - chats.otherExtractionWatermarkMessageId TEXT — fold-grain OTHER pass watermark
 *
 * `ADD COLUMN ... DEFAULT 'hot'` stamps every existing row hot, so there is no
 * backfill loop. Design of record:
 * docs/developer/features/memory-consolidation-and-tiers.md.
 *
 * Migration ID: add-memory-tiers-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-memory-tiers-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
const INDEX_NAME = 'idx_memories_character_tier';

/** The tier columns on `memories`, in the order they are added. */
const MEMORY_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'tier', ddl: `TEXT DEFAULT 'hot'` },
  { name: 'supersededById', ddl: 'TEXT DEFAULT NULL' },
  { name: 'consolidatedFrom', ddl: `TEXT DEFAULT '[]'` },
  { name: 'consolidatedAt', ddl: 'TEXT DEFAULT NULL' },
];

const CHAT_WATERMARK_COLUMN = 'otherExtractionWatermarkMessageId';

interface WorkNeeded {
  memoryColumns: string[];
  needsIndex: boolean;
  needsChatWatermark: boolean;
  nullTierRows: number;
}

function assessWork(): WorkNeeded {
  const work: WorkNeeded = {
    memoryColumns: [],
    needsIndex: false,
    needsChatWatermark: false,
    nullTierRows: 0,
  };
  if (!isSQLiteBackend()) return work;

  const db = getSQLiteDatabase();

  if (sqliteTableExists('memories')) {
    for (const col of MEMORY_COLUMNS) {
      if (!sqliteColumnExists('memories', col.name)) work.memoryColumns.push(col.name);
    }
    const hasIndex = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
      .get(INDEX_NAME);
    work.needsIndex = !hasIndex;
    if (sqliteColumnExists('memories', 'tier')) {
      // A fresh database whose table came from the Zod DDL has no column
      // default; any row that slipped in with NULL is healed to hot.
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM memories WHERE tier IS NULL OR consolidatedFrom IS NULL`)
        .get() as { n: number | bigint };
      work.nullTierRows = Number(row.n);
    }
  }

  if (sqliteTableExists('chats')) {
    work.needsChatWatermark = !sqliteColumnExists('chats', CHAT_WATERMARK_COLUMN);
  }

  return work;
}

export const addMemoryTiersMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Add tier/supersededById/consolidatedFrom/consolidatedAt to memories (+ (characterId, tier) index) and chats.otherExtractionWatermarkMessageId',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-episodic-memory-fields-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    const work = assessWork();
    return (
      work.memoryColumns.length > 0 ||
      work.needsIndex ||
      work.needsChatWatermark ||
      work.nullTierRows > 0
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();
      const work = assessWork();

      for (const col of MEMORY_COLUMNS) {
        if (!work.memoryColumns.includes(col.name)) continue;
        if (addColumnIfMissing('memories', col.name, col.ddl)) {
          itemsAffected++;
          logger.info(`Added memories.${col.name} column`, { context: LOG_CONTEXT });
        }
      }

      if (work.needsIndex && sqliteTableExists('memories')) {
        db.exec(`CREATE INDEX IF NOT EXISTS "${INDEX_NAME}" ON "memories" ("characterId", "tier")`);
        itemsAffected++;
        logger.info(`Created ${INDEX_NAME}`, { context: LOG_CONTEXT });
      }

      if (sqliteTableExists('memories') && sqliteColumnExists('memories', 'tier')) {
        const healed = db
          .prepare(
            `UPDATE memories
                SET tier = COALESCE(tier, 'hot'),
                    consolidatedFrom = COALESCE(consolidatedFrom, '[]')
              WHERE tier IS NULL OR consolidatedFrom IS NULL`,
          )
          .run();
        if (healed.changes > 0) {
          itemsAffected += healed.changes;
          logger.info('Stamped NULL-tier memories hot', {
            context: LOG_CONTEXT,
            rows: healed.changes,
          });
        }
      }

      if (work.needsChatWatermark && addColumnIfMissing('chats', CHAT_WATERMARK_COLUMN, 'TEXT DEFAULT NULL')) {
        itemsAffected++;
        logger.info(`Added chats.${CHAT_WATERMARK_COLUMN} column`, { context: LOG_CONTEXT });
      }

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Memory tiers in place (${itemsAffected} changes)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Memory-tiers migration failed', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected,
        message: `Memory-tiers migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
