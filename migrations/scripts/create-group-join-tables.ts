/**
 * Migration: Create the group join tables (mount-index DB)
 *
 * Creates `group_doc_mount_links` (a group's *additional linked* stores — the
 * official store lives on the group row) and `group_character_members` (the
 * many-to-many character↔group membership) in the dedicated mount-index
 * database, co-located with the other mount data.
 *
 * Belt-and-suspenders: the repositories self-create these tables on first
 * `getCollection()` (like `ProjectDocMountLinksRepository`), but we create them
 * here too so a fresh instance has them before first use. Idempotent via
 * `CREATE TABLE IF NOT EXISTS`.
 *
 * Migration ID: create-group-join-tables-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { isSQLiteBackend } from '../lib/database-utils';
import { getMountIndexDatabasePath } from '../../lib/paths';

const MIGRATION_ID = 'create-group-join-tables-v1';

const TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "group_doc_mount_links" (
    "id" TEXT PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "mountPointId" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`,
  // UNIQUE(groupId, mountPointId): hard guarantee against duplicate links (the
  // repository's read-before-insert is racy under concurrency). Also serves
  // groupId-prefix lookups, so no separate groupId index is needed.
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_group_doc_mount_links_group_mount" ON "group_doc_mount_links" ("groupId", "mountPointId")`,
  `CREATE INDEX IF NOT EXISTS "idx_group_doc_mount_links_mountPointId" ON "group_doc_mount_links" ("mountPointId")`,
  `CREATE TABLE IF NOT EXISTS "group_character_members" (
    "id" TEXT PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`,
  // characterId is the hot path for per-responding-character tier resolution.
  `CREATE INDEX IF NOT EXISTS "idx_group_character_members_characterId" ON "group_character_members" ("characterId")`,
  // UNIQUE(groupId, characterId): hard guarantee against duplicate memberships;
  // also serves groupId-prefix lookups, so no separate groupId index is needed.
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_group_character_members_group_char" ON "group_character_members" ("groupId", "characterId")`,
];

function openMountIndexDb(): DatabaseType {
  const dbPath = getMountIndexDatabasePath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  try {
    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      const keyHex = Buffer.from(pepper, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    return db;
  } catch (error) {
    try { db.close(); } catch { /* ignore */ }
    throw error;
  }
}

export const createGroupJoinTablesMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Create group_doc_mount_links and group_character_members tables (mount-index DB) + indexes',
  introducedInVersion: '4.7.0',

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    // The mount-index DB lives separately; always (re)assert the tables — the
    // DDL is IF NOT EXISTS so re-running is a cheap no-op. Returning true here
    // keeps the loading-screen label honest on a fresh instance.
    const dbPath = getMountIndexDatabasePath();
    if (!fs.existsSync(dbPath)) return true;
    let db: DatabaseType | null = null;
    try {
      db = openMountIndexDb();
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('group_doc_mount_links','group_character_members')`,
        )
        .get() as { n: number };
      return row.n < 2;
    } catch {
      // If we can't open/inspect the mount-index DB, attempt the creation.
      return true;
    } finally {
      try { db?.close(); } catch { /* ignore */ }
    }
  },

  async run(): Promise<MigrationResult> {
    const start = Date.now();
    let db: DatabaseType | null = null;
    try {
      db = openMountIndexDb();
      for (const sql of TABLE_DDL) {
        db.exec(sql);
      }

      logger.info(`[${MIGRATION_ID}] Created group join tables in mount-index DB`);

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 0,
        message: 'Created group_doc_mount_links and group_character_members tables',
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[${MIGRATION_ID}] Failed to create group join tables`, { error: message });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to create group join tables',
        error: message,
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    } finally {
      try { db?.close(); } catch { /* ignore */ }
    }
  },
};
