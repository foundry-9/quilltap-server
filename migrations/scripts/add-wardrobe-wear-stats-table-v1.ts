/**
 * Migration: Add Wardrobe Wear Stats Table
 *
 * Creates `wardrobe_wear_stats`, the wear ledger: per (wardrobe item × wearer)
 * a wear count, first and last worn, and the chat it was last worn in.
 *
 * Wardrobe items are vault files, not rows, so the tally cannot live in their
 * frontmatter without rewriting the whole `Wardrobe/` folder on every wear and
 * turning `updatedAt` into "last worn". See
 * docs/developer/features/complete/wardrobe-wear-ledger.md.
 *
 * The DDL is shared with the repository tests through
 * `lib/database/backends/sqlite/wardrobe-wear-stats-ddl.ts`.
 *
 * Migration ID: add-wardrobe-wear-stats-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import { WARDROBE_WEAR_STATS_DDL } from '@/lib/database/backends/sqlite/wardrobe-wear-stats-ddl';

const MIGRATION_ID = 'add-wardrobe-wear-stats-table-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addWardrobeWearStatsTableMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Create wardrobe_wear_stats table: who has worn which wardrobe item, how often, and when',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    return !sqliteTableExists('wardrobe_wear_stats');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      for (const statement of WARDROBE_WEAR_STATS_DDL) {
        db.exec(statement);
      }

      logger.info('Created wardrobe_wear_stats table', { context: LOG_CONTEXT });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 1,
        message: 'Created wardrobe_wear_stats table',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to create wardrobe_wear_stats table', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to create wardrobe_wear_stats table',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
