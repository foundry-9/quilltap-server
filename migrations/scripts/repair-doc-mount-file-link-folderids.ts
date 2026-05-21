/**
 * Migration: Repair drifted folderId on doc_mount_file_links rows
 *
 * `doc_mount_file_links.folderId` is supposed to point at the
 * `doc_mount_folders` row whose `path` equals `posix.dirname(relativePath)`,
 * with `null` for files at the root of a mount. On existing instances we
 * observe widespread drift: filesystem-scanned rows arrive with `folderId =
 * null` regardless of subdirectory (the scanner never passed one), and a
 * handful of database-backed writes set folderId to a stale value when the
 * file was moved.
 *
 * This migration walks every doc_mount_file_links row, derives the canonical
 * folderId from `(mountPointId, relativePath)`, creates any missing folder
 * rows along the way, and UPDATEs the link row when its current folderId
 * disagrees with the derived one. Idempotent — running twice is a no-op.
 *
 * Pairs with the repository-level fix in
 * `lib/database/repositories/doc-mount-file-links.repository.ts`, which
 * derives folderId at write time so new rows arrive correct. This migration
 * exists to repair the historical mess on instances upgrading past that
 * fix.
 *
 * Migration ID: repair-doc-mount-file-link-folderids-v1
 */

import Database, { Database as DatabaseType, Statement } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as posixPath from 'path/posix';
import { randomUUID } from 'crypto';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import { getMountIndexDatabasePath } from '../../lib/paths';

const MIGRATION_ID = 'repair-doc-mount-file-link-folderids-v1';

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
    return db;
  } catch (error) {
    try { db.close(); } catch { /* ignore */ }
    throw error;
  }
}

function tableExists(db: DatabaseType, name: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).get(name) as { name: string } | undefined;
  return row !== undefined;
}

interface LinkRow {
  id: string;
  mountPointId: string;
  relativePath: string;
  folderId: string | null;
}

/**
 * Walk every segment of `dir` (POSIX-style, no leading/trailing slash) and
 * find-or-create a doc_mount_folders row for each. Returns the leaf
 * folderId, or null when `dir` is empty / `.`.
 *
 * Mirrors `ensureLinkFolderId` in the repository file. Kept inline here so
 * the migration has no runtime dependency on @/lib code.
 */
function ensureFolderPathSync(
  db: DatabaseType,
  findStmt: Statement<unknown[]>,
  insertStmt: Statement<unknown[]>,
  mountPointId: string,
  dir: string,
  now: string,
): string | null {
  if (!dir || dir === '.' || dir === '/') return null;
  const normalized = dir.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return null;
  const segments = normalized.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return null;

  let currentParentId: string | null = null;
  let currentPath = '';

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    let row = findStmt.get(mountPointId, currentPath) as { id: string } | undefined;
    if (!row) {
      const id = randomUUID();
      try {
        insertStmt.run(id, mountPointId, currentParentId, segment, currentPath, now, now);
        currentParentId = id;
        continue;
      } catch (err) {
        row = findStmt.get(mountPointId, currentPath) as { id: string } | undefined;
        if (!row) throw err;
      }
    }
    currentParentId = row.id;
  }

  return currentParentId;
}

export const repairDocMountFileLinkFolderIdsMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Repair drifted folderId on doc_mount_file_links rows by re-deriving from relativePath; create any missing doc_mount_folders rows along the way',
  introducedInVersion: '4.5.0',
  dependsOn: ['add-doc-mount-file-links-v1'],

  async shouldRun(): Promise<boolean> {
    const dbPath = getMountIndexDatabasePath();
    if (!fs.existsSync(dbPath)) return false;
    const db = openMountIndexDb();
    if (!db) return false;
    try {
      if (!tableExists(db, 'doc_mount_file_links')) return false;
      if (!tableExists(db, 'doc_mount_folders')) return false;

      // Any link whose relativePath sits in a subfolder but whose folderId
      // is null is drift we want to repair. We don't try to detect
      // disagreement-but-non-null here — the run() pass catches that too,
      // and SELECT EXISTS for the null case is cheap and covers the common
      // bug source (scanner writes).
      const drifted = db.prepare(
        `SELECT 1 FROM doc_mount_file_links
         WHERE folderId IS NULL AND relativePath LIKE '%/%'
         LIMIT 1`
      ).get() as { 1: number } | undefined;
      return drifted !== undefined;
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const db = openMountIndexDb();
    if (!db) {
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 0,
        message: 'No mount-index database present; nothing to repair',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    let scanned = 0;
    let updated = 0;
    let foldersCreated = 0;

    try {
      const totalRow = db.prepare(
        'SELECT COUNT(*) AS n FROM doc_mount_file_links'
      ).get() as { n: number };
      const total = totalRow?.n ?? 0;

      if (total === 0) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'No doc_mount_file_links rows to repair',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const links = db.prepare(
        `SELECT id, mountPointId, relativePath, folderId
         FROM doc_mount_file_links
         ORDER BY mountPointId, relativePath`
      ).all() as LinkRow[];

      const folderFindStmt = db.prepare(
        'SELECT id FROM doc_mount_folders WHERE mountPointId = ? AND path = ?'
      );
      const folderInsertStmt = db.prepare(
        `INSERT INTO doc_mount_folders (id, mountPointId, parentId, name, path, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const updateLinkStmt = db.prepare(
        `UPDATE doc_mount_file_links SET folderId = ?, updatedAt = ? WHERE id = ?`
      );
      const countFoldersStmt = db.prepare(
        'SELECT COUNT(*) AS n FROM doc_mount_folders'
      );

      const folderCountBefore =
        (countFoldersStmt.get() as { n: number })?.n ?? 0;

      // One transaction per mount keeps memory bounded and reduces the
      // blast radius if a single mount's data is exotic.
      const byMount = new Map<string, LinkRow[]>();
      for (const link of links) {
        const arr = byMount.get(link.mountPointId) ?? [];
        arr.push(link);
        byMount.set(link.mountPointId, arr);
      }

      for (const [mountPointId, mountLinks] of byMount) {
        const now = new Date().toISOString();
        const tx = db.transaction(() => {
          for (const link of mountLinks) {
            scanned += 1;
            const dir = posixPath.dirname(link.relativePath || '');
            const derivedFolderId = ensureFolderPathSync(
              db,
              folderFindStmt,
              folderInsertStmt,
              mountPointId,
              dir === '.' ? '' : dir,
              now,
            );
            if (derivedFolderId !== link.folderId) {
              updateLinkStmt.run(derivedFolderId, now, link.id);
              updated += 1;
            }
            reportProgress(scanned, total, 'links');
          }
        });
        tx();
      }

      const folderCountAfter =
        (countFoldersStmt.get() as { n: number })?.n ?? 0;
      foldersCreated = folderCountAfter - folderCountBefore;

      logger.info('Repaired drifted folderId on doc_mount_file_links rows', {
        context: `migration.${MIGRATION_ID}`,
        scanned,
        updated,
        foldersCreated,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: updated,
        message: `Scanned ${scanned} links; updated ${updated}; created ${foldersCreated} missing folder rows`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  },
};
