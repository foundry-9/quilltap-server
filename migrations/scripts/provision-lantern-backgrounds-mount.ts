/**
 * Migration: Provision the global Lantern Backgrounds mount point
 *
 * Stage 1 of consolidating `_general/story-backgrounds/` (and `_general/`
 * root-level generic image-tool output) onto the Scriptorium document-store
 * pipeline. This migration creates a single database-backed mount point named
 * "Lantern Backgrounds" (storeType=documents, mountType=database) and persists
 * its id in `instance_settings.lanternBackgroundsMountPointId` so the runtime
 * Lantern bridge can find it without a name lookup.
 *
 * The mount is global (no `project_doc_mount_links` row). It surfaces in the
 * Scriptorium global mounts list and is the home for:
 *
 *   - story-background job output (subfolder `generated/`)
 *   - generic `generate_image` tool output (subfolder `tool/`)
 *
 * Idempotent: re-runs are a no-op when the setting is already populated and
 * its mount-point row still exists. If the setting points at a missing row
 * (manual deletion), the migration provisions a fresh mount and overwrites
 * the setting.
 *
 * Migration ID: provision-lantern-backgrounds-mount-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import { getMountIndexDatabasePath } from '../../lib/paths';

const MIGRATION_ID = 'provision-lantern-backgrounds-mount-v1';
const MOUNT_NAME = 'Lantern Backgrounds';
const SETTINGS_KEY = 'lanternBackgroundsMountPointId';
const SUBFOLDERS = ['generated', 'tool'] as const;

// Mirrors the DDL shape in convert-project-files-to-document-stores-v1; the
// repo-driven DDL is the source of truth at runtime but bootstrapping inside
// a migration must not rely on the repo layer being initialised.
const TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "doc_mount_points" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "basePath" TEXT NOT NULL DEFAULT '',
    "mountType" TEXT NOT NULL DEFAULT 'filesystem',
    "storeType" TEXT NOT NULL DEFAULT 'documents',
    "includePatterns" TEXT NOT NULL DEFAULT '[]',
    "excludePatterns" TEXT NOT NULL DEFAULT '[]',
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "lastScannedAt" TEXT,
    "scanStatus" TEXT NOT NULL DEFAULT 'idle',
    "lastScanError" TEXT,
    "conversionStatus" TEXT NOT NULL DEFAULT 'idle',
    "conversionError" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "totalSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "doc_mount_folders" (
    "id" TEXT PRIMARY KEY,
    "mountPointId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_folders_mp_path" ON "doc_mount_folders" ("mountPointId", "path")`,
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

function ensureMountIndexTables(db: DatabaseType): void {
  for (const sql of TABLE_DDL) {
    db.exec(sql);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureFolderPath(
  db: DatabaseType,
  mountPointId: string,
  folderPath: string
): void {
  const normalized = folderPath.replace(/^\/+|\/+$/g, '');
  if (!normalized) return;

  const segments = normalized.split('/').filter(Boolean);
  let currentParentId: string | null = null;
  let currentPath = '';

  const findStmt = db.prepare(
    `SELECT id FROM "doc_mount_folders" WHERE mountPointId = ? AND path = ?`
  );
  const insertStmt = db.prepare(
    `INSERT INTO "doc_mount_folders" (id, mountPointId, parentId, name, path, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const existing = findStmt.get(mountPointId, currentPath) as { id: string } | undefined;
    if (existing) {
      currentParentId = existing.id;
      continue;
    }
    const id = randomUUID();
    const now = nowIso();
    insertStmt.run(id, mountPointId, currentParentId, segment, currentPath, now, now);
    currentParentId = id;
  }
}

export const provisionLanternBackgroundsMountMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Provision the global "Lantern Backgrounds" database-backed mount point and persist its id in instance_settings',
  introducedInVersion: '4.13.0',
  dependsOn: [
    'create-instance-settings-table-v1',
    'convert-project-files-to-document-stores-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('instance_settings')) return false;

    const db = getSQLiteDatabase();
    const row = db
      .prepare(`SELECT "value" FROM "instance_settings" WHERE "key" = ?`)
      .get(SETTINGS_KEY) as { value: string } | undefined;

    if (!row?.value) return true;

    // Settings row points at an id — only re-provision if the row is missing.
    const dbPath = getMountIndexDatabasePath();
    if (!fs.existsSync(dbPath)) return true;
    let mountDb: DatabaseType | null = null;
    try {
      mountDb = openMountIndexDb();
      ensureMountIndexTables(mountDb);
      const exists = mountDb
        .prepare(`SELECT 1 FROM "doc_mount_points" WHERE id = ?`)
        .get(row.value) as { 1: number } | undefined;
      return !exists;
    } catch {
      return true;
    } finally {
      if (mountDb) {
        try { mountDb.close(); } catch { /* ignore */ }
      }
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let mountDb: DatabaseType | null = null;

    try {
      mountDb = openMountIndexDb();
      ensureMountIndexTables(mountDb);

      const mainDb = getSQLiteDatabase();
      const existingSetting = mainDb
        .prepare(`SELECT "value" FROM "instance_settings" WHERE "key" = ?`)
        .get(SETTINGS_KEY) as { value: string } | undefined;

      let mountPointId: string | null = existingSetting?.value ?? null;
      let adopted = false;

      if (mountPointId) {
        const existingMount = mountDb
          .prepare(`SELECT id FROM "doc_mount_points" WHERE id = ?`)
          .get(mountPointId) as { id: string } | undefined;
        if (existingMount) {
          adopted = true;
        } else {
          mountPointId = null;
        }
      }

      if (!mountPointId) {
        mountPointId = randomUUID();
        const now = nowIso();
        mountDb
          .prepare(
            `INSERT INTO "doc_mount_points"
             (id, name, basePath, mountType, storeType, includePatterns, excludePatterns,
              enabled, lastScannedAt, scanStatus, lastScanError, conversionStatus, conversionError,
              fileCount, chunkCount, totalSizeBytes, createdAt, updatedAt)
             VALUES (?, ?, '', 'database', 'documents', ?, ?, 1, NULL, 'idle', NULL,
                     'idle', NULL, 0, 0, 0, ?, ?)`
          )
          .run(
            mountPointId,
            MOUNT_NAME,
            JSON.stringify([]),
            JSON.stringify(['.git', 'node_modules', '.obsidian', '.trash']),
            now,
            now
          );

        mainDb
          .prepare(
            `INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?)
             ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`
          )
          .run(SETTINGS_KEY, mountPointId);
      }

      for (const sub of SUBFOLDERS) {
        ensureFolderPath(mountDb, mountPointId, sub);
      }

      const message = adopted
        ? `Adopted existing Lantern Backgrounds mount ${mountPointId}`
        : `Provisioned Lantern Backgrounds mount ${mountPointId}`;

      logger.info(message, {
        context: `migration.${MIGRATION_ID}`,
        mountPointId,
        adopted,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: adopted ? 0 : 1,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Provision Lantern Backgrounds migration aborted', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Provision Lantern Backgrounds migration aborted',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      if (mountDb) {
        try { mountDb.close(); } catch { /* ignore */ }
      }
    }
  },
};
