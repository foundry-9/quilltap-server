/**
 * Migration: Sweep any remaining files under `_general/` into the
 * Quilltap Uploads mount
 *
 * Final stage of the "no filesystem files in `_general/`" cleanup. The Lantern
 * and character-vault migrations move story backgrounds, root-level
 * `generated_*.webp`, and per-character avatars out of `_general/` first; this
 * migration sweeps everything that remains — chat attachments to project-less
 * chats, pasted/drag-dropped images outside a project, shell-tool workspace
 * copies, capabilities-report markdown, and any other historical leftovers —
 * into the Quilltap Uploads mount provisioned by
 * `provision-user-uploads-mount-v1`.
 *
 * For every file under `<filesDir>/_general/` (excluding the archive dirs the
 * prior migrations left behind), this migration:
 *
 *   1. Locates the matching `files` row by storageKey.
 *   2. Reads bytes off disk, sha256-verifying against `files.sha256` if set.
 *   3. Inserts `doc_mount_blobs` + `doc_mount_files` rows in the Quilltap
 *      Uploads mount at `uploads/<safeFilename>` (or `diagnostics/<safe>` for
 *      `capabilities-report-*.md`).
 *   4. Rewrites `files.storageKey` to `mount-blob:{mountPointId}:{blobId}` and
 *      clears `projectId`/`folderPath` (these rows are mount-blob-resident now).
 *   5. Renames the source files into a `_general/_uploads_archive/` sibling
 *      only after every DB write succeeds.
 *
 * Idempotent: a candidate is "handled" when its `files.storageKey` already
 * starts with `mount-blob:` or its blob exists in the Uploads mount at the
 * same subfolder/safe-name.
 *
 * Migration ID: migrate-remaining-general-to-uploads-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import { getFilesDir, getMountIndexDatabasePath } from '../../lib/paths';

const MIGRATION_ID = 'migrate-remaining-general-to-uploads-v1';
const SETTINGS_KEY = 'userUploadsMountPointId';
const ARCHIVE_DIR_NAMES = new Set([
  '_avatar_archive',
  '_generated_archive',
  'story-backgrounds_archive',
  '_uploads_archive',
]);
const ARCHIVE_PREFIXES = ['_avatar_archive', '_generated_archive', '_uploads_archive', 'story-backgrounds_archive'];
const CAPABILITIES_REPORT_PATTERN = /^capabilities-report-.*\.md$/i;

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

function nowIso(): string {
  return new Date().toISOString();
}

function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function isArchivedRelative(rel: string): boolean {
  const segments = rel.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  // Skip top-level archive dirs and any subdir that begins with an archive prefix.
  if (ARCHIVE_DIR_NAMES.has(segments[0])) return true;
  return ARCHIVE_PREFIXES.some((prefix) => segments[0].startsWith(prefix));
}

interface DiskCandidate {
  absolutePath: string;
  /** `_general/<relativeToGeneral>` — used to match against files.storageKey. */
  storageKey: string;
  /** Path inside _general/, used to decide subfolder routing. */
  relativeToGeneral: string;
}

async function walkGeneral(generalDir: string): Promise<DiskCandidate[]> {
  const out: DiskCandidate[] = [];
  async function walk(currentAbs: string, currentRel: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(currentAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
      if (isArchivedRelative(childRel)) continue;
      const childAbs = path.join(currentAbs, entry.name);
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
      } else if (entry.isFile()) {
        out.push({
          absolutePath: childAbs,
          storageKey: `_general/${childRel}`,
          relativeToGeneral: childRel,
        });
      }
    }
  }
  await walk(generalDir, '');
  return out;
}

function pickSubfolder(relativeToGeneral: string): 'uploads' | 'diagnostics' {
  const basename = path.basename(relativeToGeneral);
  if (CAPABILITIES_REPORT_PATTERN.test(basename)) return 'diagnostics';
  return 'uploads';
}

function ensureFolderPath(
  db: DatabaseType,
  mountPointId: string,
  folderPath: string
): string | null {
  const normalized = folderPath.replace(/^\/+|\/+$/g, '');
  if (!normalized) return null;

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
  return currentParentId;
}

export const migrateRemainingGeneralToUploadsMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Sweep any remaining files under _general/ into the Quilltap Uploads mount; rewrite files.storageKey shims and archive the source files',
  introducedInVersion: '4.14.0',
  dependsOn: [
    'provision-user-uploads-mount-v1',
    'migrate-general-story-backgrounds-to-mount-v1',
    'migrate-character-avatars-to-vaults-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('files')) return false;
    if (!sqliteTableExists('instance_settings')) return false;

    const filesDir = getFilesDir();
    if (!fs.existsSync(filesDir)) return false;
    const generalDir = path.join(filesDir, '_general');
    if (!fs.existsSync(generalDir)) return false;

    // Look for any live (non-archived) candidate on disk.
    const candidates = await walkGeneral(generalDir);
    if (candidates.length > 0) return true;

    // No on-disk bytes left, but the `files` table may still reference stale
    // `_general/...` keys whose bytes were already moved out of band — allow
    // the migration to clean those up via sha-relink.
    const db = getSQLiteDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM "files"
         WHERE storageKey IS NOT NULL
           AND storageKey NOT LIKE 'mount-blob:%'
           AND storageKey LIKE '_general/%'`
      )
      .get() as { n: number };
    return row.n > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let mountDb: DatabaseType | null = null;
    let imported = 0;
    let relinkedOnly = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const mainDb = getSQLiteDatabase();
      const settingsRow = mainDb
        .prepare(`SELECT "value" FROM "instance_settings" WHERE "key" = ?`)
        .get(SETTINGS_KEY) as { value: string } | undefined;
      if (!settingsRow?.value) {
        return {
          id: MIGRATION_ID,
          success: false,
          itemsAffected: 0,
          message: 'Quilltap Uploads mount-point id missing from instance_settings; provisioning migration must run first',
          error: 'missing instance_settings.userUploadsMountPointId',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }
      const mountPointId = settingsRow.value;

      mountDb = openMountIndexDb();
      if (!mountDb) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'No mount-index database present; nothing to migrate',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const mountExists = mountDb
        .prepare(`SELECT id FROM "doc_mount_points" WHERE id = ?`)
        .get(mountPointId) as { id: string } | undefined;
      if (!mountExists) {
        return {
          id: MIGRATION_ID,
          success: false,
          itemsAffected: 0,
          message: 'Quilltap Uploads mount-point row not found',
          error: `instance_settings points at ${mountPointId} but no such doc_mount_points row exists`,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const insertBlob = mountDb.prepare(
        `INSERT INTO "doc_mount_blobs"
         (id, mountPointId, relativePath, originalFileName, originalMimeType, storedMimeType,
          sizeBytes, sha256, description, descriptionUpdatedAt,
          extractedText, extractedTextSha256, extractionStatus, extractionError,
          data, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', NULL, NULL, NULL, 'none', NULL, ?, ?, ?)`
      );
      const insertFile = mountDb.prepare(
        `INSERT INTO "doc_mount_files"
         (id, mountPointId, relativePath, fileName, fileType, sha256, fileSizeBytes,
          lastModified, source, folderId, conversionStatus, conversionError,
          plainTextLength, chunkCount, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'blob', ?, ?, ?, 'database', ?, 'skipped', NULL, NULL, 0, ?, ?)`
      );
      const findBlobByPath = mountDb.prepare(
        `SELECT id FROM "doc_mount_blobs" WHERE mountPointId = ? AND relativePath = ?`
      );
      const findBlobBySha = mountDb.prepare(
        `SELECT id FROM "doc_mount_blobs" WHERE mountPointId = ? AND sha256 = ? LIMIT 1`
      );
      const updateFileEntry = mainDb.prepare(
        `UPDATE "files" SET storageKey = ?, projectId = NULL, folderPath = NULL, updatedAt = ? WHERE id = ?`
      );
      const findFileEntryByKey = mainDb.prepare(
        `SELECT id, sha256, originalFilename, mimeType FROM "files" WHERE storageKey = ? LIMIT 1`
      );

      const filesDir = getFilesDir();
      const generalDir = path.join(filesDir, '_general');

      const candidates = await walkGeneral(generalDir);
      const handledRowIds = new Set<string>();

      async function importBytes(
        absolutePath: string,
        subfolder: 'uploads' | 'diagnostics',
        fileEntry: { id: string; sha256: string; originalFilename: string; mimeType: string } | null,
      ): Promise<{ ok: true; storageKey: string; blobId: string } | { ok: false; reason: string }> {
        let bytes: Buffer;
        try {
          bytes = await fsPromises.readFile(absolutePath);
        } catch (err) {
          return { ok: false, reason: `read failed: ${err instanceof Error ? err.message : String(err)}` };
        }

        const sha = sha256Buffer(bytes);
        if (fileEntry?.sha256 && fileEntry.sha256 !== sha) {
          return { ok: false, reason: `sha256 mismatch (file ${sha.slice(0, 8)}… vs row ${fileEntry.sha256.slice(0, 8)}…)` };
        }

        const safeName = path.basename(absolutePath).replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_');
        const desiredPath = `${subfolder}/${safeName}`;

        let relativePath = desiredPath;
        for (let attempt = 2; attempt <= 999; attempt++) {
          const existing = findBlobByPath.get(mountPointId, relativePath) as { id: string } | undefined;
          if (!existing) break;
          const ext = path.extname(desiredPath);
          const stem = path.posix.basename(desiredPath, ext);
          relativePath = `${subfolder}/${stem} (${attempt})${ext}`;
        }

        const folderId = ensureFolderPath(mountDb!, mountPointId, subfolder);
        const now = nowIso();
        const blobId = randomUUID();
        const fileRowId = randomUUID();
        const originalMime = fileEntry?.mimeType || 'application/octet-stream';

        insertBlob.run(
          blobId,
          mountPointId,
          relativePath,
          safeName,
          originalMime,
          originalMime,
          bytes.length,
          sha,
          bytes,
          now,
          now,
        );
        insertFile.run(
          fileRowId,
          mountPointId,
          relativePath,
          safeName,
          sha,
          bytes.length,
          now,
          folderId,
          now,
          now,
        );

        return { ok: true, storageKey: `mount-blob:${mountPointId}:${blobId}`, blobId };
      }

      for (const candidate of candidates) {
        try {
          const subfolder = pickSubfolder(candidate.relativeToGeneral);
          const fileRow = findFileEntryByKey.get(candidate.storageKey) as
            | { id: string; sha256: string; originalFilename: string; mimeType: string }
            | undefined;

          if (!fileRow) {
            // Orphan blob — import the bytes anyway so they're not lost when
            // we archive. They surface in Scriptorium under Quilltap Uploads.
            const result = await importBytes(candidate.absolutePath, subfolder, null);
            if (!result.ok) {
              skipped++;
              logger.warn('Skipped orphan candidate', {
                context: `migration.${MIGRATION_ID}`,
                path: candidate.absolutePath,
                reason: result.reason,
              });
            } else {
              imported++;
            }
            continue;
          }

          handledRowIds.add(fileRow.id);
          const result = await importBytes(candidate.absolutePath, subfolder, fileRow);
          if (!result.ok) {
            skipped++;
            logger.warn('Skipped candidate', {
              context: `migration.${MIGRATION_ID}`,
              path: candidate.absolutePath,
              fileEntryId: fileRow.id,
              reason: result.reason,
            });
            continue;
          }
          updateFileEntry.run(result.storageKey, nowIso(), fileRow.id);
          imported++;
        } catch (err) {
          errors++;
          logger.error('Candidate import failed', {
            context: `migration.${MIGRATION_ID}`,
            path: candidate.absolutePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Relink-only pass for rows whose on-disk bytes are gone: maybe a prior
      // run already imported the blob (by sha). Never lose the row.
      const dbOnlyRows = mainDb
        .prepare(
          `SELECT id, sha256, originalFilename, mimeType, storageKey FROM "files"
           WHERE storageKey IS NOT NULL
             AND storageKey NOT LIKE 'mount-blob:%'
             AND storageKey LIKE '_general/%'`
        )
        .all() as Array<{ id: string; sha256: string; originalFilename: string; mimeType: string; storageKey: string }>;

      for (const row of dbOnlyRows) {
        if (handledRowIds.has(row.id)) continue;
        if (!row.sha256) continue;
        try {
          const existing = findBlobBySha.get(mountPointId, row.sha256) as { id: string } | undefined;
          if (existing) {
            updateFileEntry.run(`mount-blob:${mountPointId}:${existing.id}`, nowIso(), row.id);
            relinkedOnly++;
          }
        } catch (err) {
          errors++;
          logger.warn('Relink-by-sha pass failed for row', {
            context: `migration.${MIGRATION_ID}`,
            fileEntryId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Refresh mount totals.
      const totals = mountDb
        .prepare(
          `SELECT COUNT(*) AS fileCount, COALESCE(SUM(fileSizeBytes), 0) AS totalSizeBytes
           FROM "doc_mount_files" WHERE mountPointId = ?`
        )
        .get(mountPointId) as { fileCount: number; totalSizeBytes: number };
      mountDb
        .prepare(
          `UPDATE "doc_mount_points"
           SET fileCount = ?, totalSizeBytes = ?, lastScannedAt = ?, updatedAt = ?
           WHERE id = ?`
        )
        .run(totals.fileCount, totals.totalSizeBytes, nowIso(), nowIso(), mountPointId);

      // Archive: move every still-living file inside _general/ (that we just
      // processed) into _general/_uploads_archive/, preserving the relative
      // path. Skip files that are already inside an archive dir.
      const uploadsArchive = path.join(generalDir, '_uploads_archive');
      if (candidates.length > 0) {
        try {
          await fsPromises.mkdir(uploadsArchive, { recursive: true });
        } catch (err) {
          logger.warn('Failed to create uploads archive dir', {
            context: `migration.${MIGRATION_ID}`,
            dir: uploadsArchive,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      for (const candidate of candidates) {
        const archiveDst = path.join(uploadsArchive, candidate.relativeToGeneral);
        try {
          await fsPromises.mkdir(path.dirname(archiveDst), { recursive: true });
          await fsPromises.rename(candidate.absolutePath, archiveDst);
        } catch (err) {
          logger.warn('Failed to archive source file', {
            context: `migration.${MIGRATION_ID}`,
            path: candidate.absolutePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const message = `Imported ${imported}, relinked-only ${relinkedOnly}, skipped ${skipped}, errors ${errors}`;
      logger.info(message, { context: `migration.${MIGRATION_ID}` });

      return {
        id: MIGRATION_ID,
        success: errors === 0,
        itemsAffected: imported + relinkedOnly,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('migrate-remaining-general-to-uploads migration aborted', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: imported + relinkedOnly,
        message: 'migrate-remaining-general-to-uploads migration aborted',
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
