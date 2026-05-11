/**
 * Migration: Move `_general/story-backgrounds/` and root-level
 * `_general/generated_*.webp` into the Lantern Backgrounds mount
 *
 * Stage 1 of the "no filesystem files in `_general/`" cleanup for the Lantern
 * subsystem. For every file under `<filesDir>/_general/story-backgrounds/` and
 * every root-level `<filesDir>/_general/generated_*.webp`, this migration:
 *
 *   1. Locates the matching `files` row by storageKey.
 *   2. Reads bytes off disk, sha256-verifying against `files.sha256` if set.
 *   3. Inserts `doc_mount_blobs` + `doc_mount_files` rows in the Lantern
 *      Backgrounds mount at `generated/<safe>` (for story-bg subdir entries)
 *      or `tool/<safe>` (for root-level generated_*.webp).
 *   4. Rewrites `files.storageKey` to `mount-blob:{mountPointId}:{blobId}` and
 *      clears `projectId`/`folderPath` (these rows are mount-blob-resident now).
 *   5. Renames the source dirs into archive siblings only after every DB write
 *      succeeds, mirroring the safety-net pattern from
 *      `convert-project-files-to-document-stores-v1`.
 *
 * Files at the root of `_general/` are deliberately filtered: only entries
 * matching `^generated_[0-9]+.*\.webp$` are pulled in. Avatars, capability
 * reports, seed images, and user uploads at the root are out of scope here
 * (avatars get their own migration; everything else stays put).
 *
 * Idempotent: a candidate is "handled" when its `files.storageKey` already
 * starts with `mount-blob:` or its blob exists in the Lantern mount.
 *
 * Migration ID: migrate-general-story-backgrounds-to-mount-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import { getFilesDir, getMountIndexDatabasePath } from '../../lib/paths';

const MIGRATION_ID = 'migrate-general-story-backgrounds-to-mount-v1';
const SETTINGS_KEY = 'lanternBackgroundsMountPointId';
const STORY_BG_SUBDIR = '_general/story-backgrounds';
const ROOT_TOOL_PATTERN = /^generated_[0-9]+.*\.webp$/i;

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

function pickArchiveDir(baseName: string): string {
  if (!fs.existsSync(baseName)) return baseName;
  for (let i = 2; i < 100; i++) {
    const candidate = `${baseName}_v${i}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  return `${baseName}_${randomUUID()}`;
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

interface BlobInsert {
  id: string;
  fileEntryId: string;
  storageKey: string;
}

async function importOneFile(
  mountDb: DatabaseType,
  mountPointId: string,
  subfolder: 'generated' | 'tool',
  absolutePath: string,
  fileEntryRow: { id: string; sha256: string; originalFilename: string; mimeType: string },
  insertBlob: Database.Statement,
  insertFile: Database.Statement,
  findBlobByPath: Database.Statement,
): Promise<BlobInsert | { skipped: true; reason: string }> {
  let bytes: Buffer;
  try {
    bytes = await fsPromises.readFile(absolutePath);
  } catch (err) {
    return { skipped: true, reason: `read failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const sha = sha256Buffer(bytes);
  if (fileEntryRow.sha256 && fileEntryRow.sha256 !== sha) {
    return { skipped: true, reason: `sha256 mismatch (file ${sha.slice(0, 8)}… vs row ${fileEntryRow.sha256.slice(0, 8)}…)` };
  }

  const safeName = path.basename(absolutePath).replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_');
  const desiredPath = `${subfolder}/${safeName}`;

  // Collision bump in case the migration is re-run after a partial write.
  let relativePath = desiredPath;
  for (let attempt = 2; attempt <= 999; attempt++) {
    const existing = findBlobByPath.get(mountPointId, relativePath) as { id: string } | undefined;
    if (!existing) break;
    const ext = path.extname(desiredPath);
    const stem = path.posix.basename(desiredPath, ext);
    relativePath = `${subfolder}/${stem} (${attempt})${ext}`;
  }

  const folderId = ensureFolderPath(mountDb, mountPointId, subfolder);
  const now = nowIso();
  const blobId = randomUUID();
  const fileRowId = randomUUID();
  const originalMime = fileEntryRow.mimeType || 'image/webp';

  insertBlob.run(
    blobId,
    mountPointId,
    relativePath,
    safeName,
    originalMime,
    originalMime,
    bytes.length,
    sha,
    null,
    null,
    'none',
    null,
    bytes,
    now,
    now
  );
  insertFile.run(
    fileRowId,
    mountPointId,
    relativePath,
    safeName,
    'blob',
    sha,
    bytes.length,
    now,
    folderId,
    'skipped',
    null,
    null,
    now,
    now
  );

  return {
    id: blobId,
    fileEntryId: fileEntryRow.id,
    storageKey: `mount-blob:${mountPointId}:${blobId}`,
  };
}

function listCandidatesInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export const migrateGeneralStoryBackgroundsToMountMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Move _general/story-backgrounds/ and root-level _general/generated_*.webp into the Lantern Backgrounds mount; rewrite files.storageKey shims',
  introducedInVersion: '4.13.0',
  dependsOn: [
    'provision-lantern-backgrounds-mount-v1',
    'relink-files-to-mount-blobs-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('files')) return false;
    if (!sqliteTableExists('instance_settings')) return false;

    const filesDir = getFilesDir();
    if (!fs.existsSync(filesDir)) return false;
    const generalDir = path.join(filesDir, '_general');
    if (!fs.existsSync(generalDir)) return false;

    const storyBgDir = path.join(generalDir, 'story-backgrounds');
    if (fs.existsSync(storyBgDir)) return true;

    // Check root of _general/ for unmigrated generated_*.webp
    const generalEntries = listCandidatesInDir(generalDir);
    if (generalEntries.some((name) => ROOT_TOOL_PATTERN.test(name))) return true;

    // No on-disk files left, but the `files` table may still reference stale
    // _general/story-backgrounds/* keys whose bytes were already moved out of
    // band; allow the migration to clean those up.
    const db = getSQLiteDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM "files"
         WHERE storageKey IS NOT NULL
           AND storageKey NOT LIKE 'mount-blob:%'
           AND (storageKey LIKE '_general/story-backgrounds/%'
             OR storageKey LIKE '_general/generated_%')`
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
          message: 'Lantern Backgrounds mount-point id missing from instance_settings; provisioning migration must run first',
          error: 'missing instance_settings.lanternBackgroundsMountPointId',
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
          message: 'Lantern Backgrounds mount-point row not found',
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertFile = mountDb.prepare(
        `INSERT INTO "doc_mount_files"
         (id, mountPointId, relativePath, fileName, fileType, sha256, fileSizeBytes,
          lastModified, source, folderId, conversionStatus, conversionError,
          plainTextLength, chunkCount, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'database', ?, ?, ?, ?, 0, ?, ?)`
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

      interface Candidate {
        absolutePath: string;
        storageKey: string;
        subfolder: 'generated' | 'tool';
      }

      const candidates: Candidate[] = [];
      const storyBgDir = path.join(generalDir, 'story-backgrounds');
      if (fs.existsSync(storyBgDir)) {
        for (const name of listCandidatesInDir(storyBgDir)) {
          candidates.push({
            absolutePath: path.join(storyBgDir, name),
            storageKey: `_general/story-backgrounds/${name}`,
            subfolder: 'generated',
          });
        }
      }
      if (fs.existsSync(generalDir)) {
        for (const name of listCandidatesInDir(generalDir)) {
          if (ROOT_TOOL_PATTERN.test(name)) {
            candidates.push({
              absolutePath: path.join(generalDir, name),
              storageKey: `_general/${name}`,
              subfolder: 'tool',
            });
          }
        }
      }

      // Pull in `files` rows that still point at _general/story-backgrounds/*
      // or _general/generated_* but whose on-disk files are gone — for those,
      // a sibling blob may already exist in the mount via sha and we can
      // simply relink the row.
      const dbOnlyRows = mainDb
        .prepare(
          `SELECT id, sha256, originalFilename, mimeType, storageKey FROM "files"
           WHERE storageKey IS NOT NULL
             AND storageKey NOT LIKE 'mount-blob:%'
             AND (storageKey LIKE '_general/story-backgrounds/%'
               OR storageKey LIKE '_general/generated_%')`
        )
        .all() as Array<{ id: string; sha256: string; originalFilename: string; mimeType: string; storageKey: string }>;

      const handledRowIds = new Set<string>();

      let candidateIndex = 0;
      for (const candidate of candidates) {
        candidateIndex++;
        reportProgress(candidateIndex, candidates.length, 'backgrounds');
        try {
          const fileRow = findFileEntryByKey.get(candidate.storageKey) as
            | { id: string; sha256: string; originalFilename: string; mimeType: string }
            | undefined;

          // No matching files row — import the bytes anyway so they're not
          // lost when we archive the directory. The orphan blob will surface
          // in the Scriptorium UI under Lantern Backgrounds.
          if (!fileRow) {
            const bytes = await fsPromises.readFile(candidate.absolutePath);
            const sha = sha256Buffer(bytes);
            const safeName = path.basename(candidate.absolutePath).replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_');
            const existing = findBlobByPath.get(mountPointId, `${candidate.subfolder}/${safeName}`) as { id: string } | undefined;
            if (existing) {
              skipped++;
              continue;
            }
            const result = await importOneFile(
              mountDb,
              mountPointId,
              candidate.subfolder,
              candidate.absolutePath,
              { id: '', sha256: sha, originalFilename: safeName, mimeType: 'image/webp' },
              insertBlob,
              insertFile,
              findBlobByPath,
            );
            if ('skipped' in result) {
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

          const result = await importOneFile(
            mountDb,
            mountPointId,
            candidate.subfolder,
            candidate.absolutePath,
            fileRow,
            insertBlob,
            insertFile,
            findBlobByPath,
          );

          if ('skipped' in result) {
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

      // Relink-only pass for rows whose on-disk bytes are missing: maybe a
      // prior run already imported the blob (by sha), or maybe the row is
      // genuinely orphaned. Either way, never lose the row — we either link
      // it to an existing blob or leave it untouched for inspection.
      let dbOnlyIndex = 0;
      for (const row of dbOnlyRows) {
        dbOnlyIndex++;
        reportProgress(dbOnlyIndex, dbOnlyRows.length, 'orphan rows');
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

      // Archive source dirs/files — only after DB writes succeeded.
      if (fs.existsSync(storyBgDir)) {
        const archive = pickArchiveDir(`${storyBgDir}_archive`);
        try {
          await fsPromises.rename(storyBgDir, archive);
        } catch (err) {
          logger.warn('Failed to archive story-backgrounds dir; leaving in place', {
            context: `migration.${MIGRATION_ID}`,
            dir: storyBgDir,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Move root-level generated_*.webp into an archive sibling.
      const rootArchive = path.join(generalDir, '_generated_archive');
      const rootCandidates = fs.existsSync(generalDir)
        ? listCandidatesInDir(generalDir).filter((n) => ROOT_TOOL_PATTERN.test(n))
        : [];
      if (rootCandidates.length > 0) {
        try {
          await fsPromises.mkdir(rootArchive, { recursive: true });
          for (const name of rootCandidates) {
            const src = path.join(generalDir, name);
            const dst = path.join(rootArchive, name);
            try {
              await fsPromises.rename(src, dst);
            } catch (err) {
              logger.warn('Failed to archive root-level generated file', {
                context: `migration.${MIGRATION_ID}`,
                path: src,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } catch (err) {
          logger.warn('Failed to create root-level archive dir', {
            context: `migration.${MIGRATION_ID}`,
            dir: rootArchive,
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
      logger.error('migrate-general-story-backgrounds-to-mount migration aborted', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: imported + relinkedOnly,
        message: 'migrate-general-story-backgrounds-to-mount migration aborted',
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
