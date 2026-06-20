/**
 * Migration: Create the `groups` table (main DB)
 *
 * Groups are a cross-section of characters (parallel to how a Project is a
 * cross-section of files/chats). The row is slim — id, name,
 * officialMountPointId, timestamps — with all substantive content living in the
 * group's official document store (overlaid on read by `groups.repository.ts`).
 *
 * Pure DDL; no data backfill (Groups is a new feature with no legacy rows).
 * Official stores are provisioned lazily at group-create time and re-ensured on
 * startup. Idempotent: `shouldRun` returns false once the table exists.
 *
 * Migration ID: create-groups-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

const MIGRATION_ID = 'create-groups-table-v1';

export const createGroupsTableMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Create the slim `groups` table (id, name, officialMountPointId, timestamps) + name index',
  introducedInVersion: '4.7.0',

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    return !sqliteTableExists('groups');
  },

  async run(): Promise<MigrationResult> {
    const start = Date.now();
    try {
      const db = getSQLiteDatabase();

      db.exec(`
        CREATE TABLE IF NOT EXISTS "groups" (
          "id" TEXT PRIMARY KEY,
          "name" TEXT NOT NULL,
          "officialMountPointId" TEXT DEFAULT NULL,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS "idx_groups_name" ON "groups" ("name")`);

      logger.info(`[${MIGRATION_ID}] Created groups table`);

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 0,
        message: 'Created groups table and name index',
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[${MIGRATION_ID}] Failed to create groups table`, { error: message });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to create groups table',
        error: message,
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
