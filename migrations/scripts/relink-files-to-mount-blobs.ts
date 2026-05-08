/**
 * Migration: Relink legacy `files.storageKey` rows to mount-blob shims
 *
 * `convert-project-files-to-document-stores-v1` (Stage 1) imported each
 * project's on-disk files into `doc_mount_blobs` and renamed
 * `<filesDir>/<projectId>` to `<projectId>_doc_store_archive`. Its docstring
 * acknowledges that "Legacy FileEntry … rows in the main DB are deliberately
 * left in place in this stage; Stage 2 will rewire the file APIs and clean
 * them up." Stage 2 (the runtime side) was implemented for new writes via
 * `writeProjectFileToMountStore`, but the *existing* `files` rows that
 * predated Stage 1 were never rewritten.
 *
 * Result: the `files` table still references storage keys like
 * `<projectId>/character-avatars/avatar_X.webp` whose bytes only live inside
 * the `doc_mount_blobs` table now. `FileStorageManager.downloadFile` doesn't
 * recognize the bare path as a `mount-blob:` shim, falls through to the local
 * disk backend, and ENOENTs — so `/api/v1/files/{id}` returns 500 for every
 * orphaned image (visible in the Aurora gallery as broken-image tiles, and
 * fatal for "Set as avatar" / chat-message attachments / exports).
 *
 * This migration walks `files`, and for any row whose storageKey starts with
 * `<projectId>/` (where the project still exists and has a database-backed
 * documents store), looks up the matching `doc_mount_blobs` row by
 * `(mountPointId, relativePath)` and verifies sha256. On a clean match it
 * rewrites `files.storageKey` to `mount-blob:{mountPointId}:{blobId}`.
 *
 * Idempotent: rows already on the shim are skipped. Rows with no matching
 * blob (or a sha256 mismatch) are left untouched and logged — those will
 * either need restoration from backup or to be marked missing in a future
 * pass; this migration does not attempt to delete them.
 *
 * Migration ID: relink-files-to-mount-blobs-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';
import { getMountIndexDatabasePath } from '../../lib/paths';

const MIGRATION_ID = 'relink-files-to-mount-blobs-v1';

function openMountIndexDb(): DatabaseType | null {
  const dbPath = getMountIndexDatabasePath();
  if (!fs.existsSync(path.dirname(dbPath))) return null;
  if (!fs.existsSync(dbPath)) return null;
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

interface CandidateFileRow {
  id: string;
  sha256: string;
  storageKey: string;
}

interface BlobRow {
  id: string;
  sha256: string;
}

function buildProjectMountMap(
  mainDb: DatabaseType,
  mountDb: DatabaseType
): Map<string, string> {
  const map = new Map<string, string>();

  // Prefer projects.officialMountPointId where the column exists and is set.
  const projectColumns = getSQLiteTableColumns('projects');
  const hasOfficialFk = projectColumns.some((c) => c.name === 'officialMountPointId');
  if (hasOfficialFk) {
    const rows = mainDb.prepare(
      `SELECT id, officialMountPointId FROM "projects" WHERE officialMountPointId IS NOT NULL`
    ).all() as Array<{ id: string; officialMountPointId: string }>;
    for (const r of rows) map.set(r.id, r.officialMountPointId);
  }

  // Fill in remaining projects from the link table — pick the oldest
  // database-backed `documents` store, mirroring `pickPrimaryProjectStore`.
  const allProjects = mainDb.prepare(`SELECT id FROM "projects"`).all() as Array<{ id: string }>;
  const linkStmt = mountDb.prepare(
    `SELECT link.mountPointId AS mountPointId
     FROM "project_doc_mount_links" link
     JOIN "doc_mount_points" mp ON mp.id = link.mountPointId
     WHERE link.projectId = ?
       AND mp.mountType = 'database'
       AND mp.storeType = 'documents'
     ORDER BY link.createdAt ASC
     LIMIT 1`
  );
  for (const p of allProjects) {
    if (map.has(p.id)) continue;
    const link = linkStmt.get(p.id) as { mountPointId: string } | undefined;
    if (link) map.set(p.id, link.mountPointId);
  }

  return map;
}

function selectCandidates(mainDb: DatabaseType): CandidateFileRow[] {
  return mainDb.prepare(
    `SELECT id, sha256, storageKey
     FROM "files"
     WHERE storageKey IS NOT NULL
       AND storageKey NOT LIKE 'mount-blob:%'
       AND instr(storageKey, '/') > 0`
  ).all() as CandidateFileRow[];
}

export const relinkFilesToMountBlobsMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Rewrite legacy files.storageKey values pointing at pre-Stage-1 project directories to the mount-blob shim that resolves through doc_mount_blobs',
  introducedInVersion: '4.4.0',
  dependsOn: [
    'convert-project-files-to-document-stores-v1',
    'add-project-official-mount-point-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('files')) return false;
    if (!sqliteTableExists('projects')) return false;
    if (!fs.existsSync(getMountIndexDatabasePath())) return false;

    const db = getSQLiteDatabase();
    const row = db.prepare(
      `SELECT COUNT(*) AS n
       FROM "files"
       WHERE storageKey IS NOT NULL
         AND storageKey NOT LIKE 'mount-blob:%'
         AND instr(storageKey, '/') > 0
         AND substr(storageKey, 1, instr(storageKey, '/') - 1) IN (
           SELECT id FROM "projects"
         )`
    ).get() as { n: number };
    return row.n > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let mountDb: DatabaseType | null = null;
    let relinked = 0;
    let skippedNoLink = 0;
    let unmatchedBlob = 0;
    let shaMismatch = 0;

    try {
      mountDb = openMountIndexDb();
      if (!mountDb) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'No mount-index database present; nothing to relink',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const mainDb = getSQLiteDatabase();
      const projectMountMap = buildProjectMountMap(mainDb, mountDb);
      if (projectMountMap.size === 0) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'No projects with linked database-backed mount points; nothing to relink',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const candidates = selectCandidates(mainDb);
      if (candidates.length === 0) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'No legacy files.storageKey rows to relink',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const findBlob = mountDb.prepare(
        `SELECT id, sha256 FROM "doc_mount_blobs"
         WHERE mountPointId = ? AND relativePath = ?`
      );

      const updateFile = mainDb.prepare(
        `UPDATE "files" SET storageKey = ?, updatedAt = ? WHERE id = ?`
      );

      const applyAll = mainDb.transaction((rows: CandidateFileRow[]) => {
        for (const row of rows) {
          const slashIdx = row.storageKey.indexOf('/');
          if (slashIdx < 0) { skippedNoLink++; continue; }
          const projectId = row.storageKey.slice(0, slashIdx);
          const relativePath = row.storageKey.slice(slashIdx + 1);
          const mountPointId = projectMountMap.get(projectId);
          if (!mountPointId) { skippedNoLink++; continue; }

          const blob = findBlob.get(mountPointId, relativePath) as BlobRow | undefined;
          if (!blob) {
            unmatchedBlob++;
            logger.warn('Relink: no blob match for legacy storageKey', {
              context: `migration.${MIGRATION_ID}`,
              fileId: row.id,
              projectId,
              mountPointId,
              relativePath,
            });
            continue;
          }
          if (blob.sha256 !== row.sha256) {
            shaMismatch++;
            logger.warn('Relink: blob sha256 mismatch — leaving file row untouched', {
              context: `migration.${MIGRATION_ID}`,
              fileId: row.id,
              projectId,
              mountPointId,
              relativePath,
              fileSha: row.sha256,
              blobSha: blob.sha256,
            });
            continue;
          }

          updateFile.run(
            `mount-blob:${mountPointId}:${blob.id}`,
            new Date().toISOString(),
            row.id
          );
          relinked++;
        }
      });
      applyAll(candidates);

      const message = `Relinked ${relinked} files row(s) to mount-blob shim; ${skippedNoLink} skipped (no project link), ${unmatchedBlob} unmatched (no blob at relativePath), ${shaMismatch} sha mismatch`;
      logger.info(message, {
        context: `migration.${MIGRATION_ID}`,
        relinked,
        skippedNoLink,
        unmatchedBlob,
        shaMismatch,
        scanned: candidates.length,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: relinked,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Relink-files-to-mount-blobs migration aborted', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: relinked,
        message: 'Relink-files-to-mount-blobs migration aborted',
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
