/**
 * Migration: Move character avatars off `_general/` into each character's vault
 *
 * Stage 1 of the "no filesystem files in `_general/`" cleanup for the avatar
 * subsystem. For every character that has a linked database-backed vault
 * (`characters.characterDocumentMountPointId`), this migration walks the
 * character's avatar `files` rows and imports any whose storageKey still
 * points at `_general/...` into the vault's `images/` folder:
 *
 *   - `defaultImageId`'s row (if anchored on disk) → `images/avatar.webp`
 *     (replaces any prior blob at that exact path so re-runs are safe).
 *   - Every other `files` row linked to the character with a disk-anchored
 *     storageKey → `images/history/<safeFilename>` with `(2)` etc.
 *     collision bumping.
 *
 * For each successfully imported row the migration:
 *   1. Inserts `doc_mount_blobs` + `doc_mount_files` mirror rows in the vault.
 *   2. Rewrites `files.storageKey` to `mount-blob:{vaultMountPointId}:{blobId}`
 *      and clears `projectId` / `folderPath` (the row is mount-blob-resident).
 *   3. Renames the on-disk source into `_general/_avatar_archive/...` only
 *      after the DB writes commit (per-file rename, since multiple characters
 *      share the dir).
 *
 * Project-scoped avatars (storageKey already starts with `mount-blob:` from
 * `relink-files-to-mount-blobs-v1`) are intentionally left alone — those
 * legitimately live in their project's mount, not the character vault.
 *
 * Idempotent per row via the unique `(mountPointId, relativePath)` index;
 * characters with no vault are skipped (a subsequent run after vault
 * provisioning handles them).
 *
 * Migration ID: migrate-character-avatars-to-vaults-v1
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
  getSQLiteTableColumns,
} from '../lib/database-utils';
import { getFilesDir, getMountIndexDatabasePath } from '../../lib/paths';

const MIGRATION_ID = 'migrate-character-avatars-to-vaults-v1';
const MAIN_AVATAR_PATH = 'images/avatar.webp';
const HISTORY_FOLDER = 'images/history';
const ARCHIVE_DIR_NAME = '_avatar_archive';

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

const UNSAFE_LEAF_CHARS = /[\/\\:*?"<>|\x00-\x1f\x7f]/g;

function sanitizeLeafName(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  let safe = basename.replace(UNSAFE_LEAF_CHARS, '_').replace(/_{2,}/g, '_');
  safe = safe.replace(/^[_.]+/, '').replace(/[_.]+$/, '');
  return safe || 'unnamed';
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

interface CharacterRow {
  id: string;
  name: string;
  characterDocumentMountPointId: string;
  defaultImageId: string | null;
}

interface FileRow {
  id: string;
  sha256: string;
  originalFilename: string;
  mimeType: string;
  storageKey: string;
  category: string;
  linkedTo: string;
}

function listCharactersWithVaults(): CharacterRow[] {
  const cols = getSQLiteTableColumns('characters').map((c) => c.name);
  if (!cols.includes('characterDocumentMountPointId')) return [];
  if (!cols.includes('defaultImageId')) return [];

  const db = getSQLiteDatabase();
  return db
    .prepare(
      `SELECT id, name, characterDocumentMountPointId, defaultImageId
       FROM "characters"
       WHERE characterDocumentMountPointId IS NOT NULL`
    )
    .all() as CharacterRow[];
}

function findFileRow(db: DatabaseType, id: string | null): FileRow | null {
  if (!id) return null;
  return (
    (db
      .prepare(
        `SELECT id, sha256, originalFilename, mimeType, storageKey, category, linkedTo
         FROM "files" WHERE id = ?`
      )
      .get(id) as FileRow | undefined) ?? null
  );
}

function findHistoryFileRows(
  db: DatabaseType,
  characterId: string,
  excludeFileId: string | null
): FileRow[] {
  // linkedTo is a JSON array stored as TEXT; UUID substring search is reliable.
  const rows = db
    .prepare(
      `SELECT id, sha256, originalFilename, mimeType, storageKey, category, linkedTo
       FROM "files"
       WHERE storageKey IS NOT NULL
         AND storageKey LIKE '_general/%'
         AND storageKey NOT LIKE 'mount-blob:%'
         AND linkedTo LIKE ?
         ${excludeFileId ? 'AND id != ?' : ''}`
    )
    .all(
      ...(excludeFileId
        ? [`%${characterId}%`, excludeFileId]
        : [`%${characterId}%`])
    ) as FileRow[];

  // Belt-and-suspenders: parse linkedTo and confirm characterId is actually in
  // the array. (UUID v4 collisions across hex slots are vanishingly rare, but
  // a partial string match is still possible if a UUID happens to share a
  // substring.)
  return rows.filter((r) => {
    try {
      const arr = JSON.parse(r.linkedTo ?? '[]') as unknown;
      return Array.isArray(arr) && arr.includes(characterId);
    } catch {
      return false;
    }
  });
}

function storageKeyToAbsolutePath(filesDir: string, storageKey: string): string | null {
  // storageKey is POSIX-style relative to filesDir; _general/foo → <filesDir>/_general/foo.
  if (!storageKey || storageKey.includes('..')) return null;
  return path.join(filesDir, ...storageKey.split('/'));
}

async function archiveSourceFile(
  filesDir: string,
  absolutePath: string,
  originalFilename: string
): Promise<void> {
  const archiveDir = path.join(filesDir, '_general', ARCHIVE_DIR_NAME);
  await fsPromises.mkdir(archiveDir, { recursive: true });
  const safe = sanitizeLeafName(originalFilename || path.basename(absolutePath));
  let dest = path.join(archiveDir, safe);
  if (fs.existsSync(dest)) {
    const ext = path.extname(safe);
    const stem = path.basename(safe, ext);
    for (let i = 2; i < 1000; i++) {
      const candidate = path.join(archiveDir, `${stem} (${i})${ext}`);
      if (!fs.existsSync(candidate)) {
        dest = candidate;
        break;
      }
    }
  }
  await fsPromises.rename(absolutePath, dest);
}

export const migrateCharacterAvatarsToVaultsMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Move character avatars (main + history) from `_general/` into each character\'s database-backed vault under images/',
  introducedInVersion: '4.13.0',
  dependsOn: [
    'add-character-document-mount-point-field-v1',
    'convert-project-files-to-document-stores-v1',
    'relink-files-to-mount-blobs-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('characters')) return false;
    if (!sqliteTableExists('files')) return false;
    if (!fs.existsSync(getMountIndexDatabasePath())) return false;

    const candidates = listCharactersWithVaults();
    if (candidates.length === 0) return false;

    const db = getSQLiteDatabase();
    // Any character-linked files row anchored to `_general/`?
    for (const char of candidates) {
      const row = db
        .prepare(
          `SELECT 1 FROM "files"
           WHERE storageKey IS NOT NULL
             AND storageKey LIKE '_general/%'
             AND storageKey NOT LIKE 'mount-blob:%'
             AND linkedTo LIKE ?
           LIMIT 1`
        )
        .get(`%${char.id}%`) as { 1: number } | undefined;
      if (row) return true;
    }
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let mountDb: DatabaseType | null = null;
    let importedMain = 0;
    let importedHistory = 0;
    let archivedFiles = 0;
    let skipped = 0;
    let errors = 0;

    try {
      mountDb = openMountIndexDb();
      if (!mountDb) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'No mount-index database; nothing to migrate',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }
      const mountDbConn = mountDb;

      const mainDb = getSQLiteDatabase();
      const filesDir = getFilesDir();

      const characters = listCharactersWithVaults();
      if (characters.length === 0) {
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: 0,
          message: 'No characters with vaults found',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const insertBlob = mountDbConn.prepare(
        `INSERT INTO "doc_mount_blobs"
         (id, mountPointId, relativePath, originalFileName, originalMimeType, storedMimeType,
          sizeBytes, sha256, description, descriptionUpdatedAt,
          extractedText, extractedTextSha256, extractionStatus, extractionError,
          data, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'none', NULL, ?, ?, ?)`
      );
      const insertFile = mountDbConn.prepare(
        `INSERT INTO "doc_mount_files"
         (id, mountPointId, relativePath, fileName, fileType, sha256, fileSizeBytes,
          lastModified, source, folderId, conversionStatus, conversionError,
          plainTextLength, chunkCount, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'blob', ?, ?, ?, 'database', ?, 'skipped', NULL, NULL, 0, ?, ?)`
      );
      const findBlobByPath = mountDbConn.prepare(
        `SELECT id FROM "doc_mount_blobs" WHERE mountPointId = ? AND relativePath = ?`
      );
      const findFileByPath = mountDbConn.prepare(
        `SELECT id FROM "doc_mount_files" WHERE mountPointId = ? AND relativePath = ?`
      );
      const deleteBlobByPath = mountDbConn.prepare(
        `DELETE FROM "doc_mount_blobs" WHERE mountPointId = ? AND relativePath = ?`
      );
      const deleteFileById = mountDbConn.prepare(
        `DELETE FROM "doc_mount_files" WHERE id = ?`
      );
      const deleteChunksByFile = mountDbConn.prepare(
        `DELETE FROM "doc_mount_chunks" WHERE fileId = ?`
      );
      const updateMountTotals = mountDbConn.prepare(
        `UPDATE "doc_mount_points"
         SET fileCount = (SELECT COUNT(*) FROM "doc_mount_files" WHERE mountPointId = ?),
             totalSizeBytes = (SELECT COALESCE(SUM(fileSizeBytes), 0) FROM "doc_mount_files" WHERE mountPointId = ?),
             updatedAt = ?
         WHERE id = ?`
      );

      const updateFileEntry = mainDb.prepare(
        `UPDATE "files" SET storageKey = ?, projectId = NULL, folderPath = NULL, updatedAt = ? WHERE id = ?`
      );

      const chunksTableExists = (() => {
        try {
          return mountDbConn
            .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='doc_mount_chunks'`)
            .get() !== undefined;
        } catch {
          return false;
        }
      })();

      interface AvatarTarget {
        fileRow: FileRow;
        kind: 'main' | 'history';
      }

      let characterIndex = 0;
      for (const character of characters) {
        characterIndex++;
        reportProgress(characterIndex, characters.length, 'characters');
        const vaultId = character.characterDocumentMountPointId;

        const targets: AvatarTarget[] = [];
        const mainRow = findFileRow(mainDb, character.defaultImageId);
        if (
          mainRow &&
          mainRow.storageKey?.startsWith('_general/') &&
          !mainRow.storageKey.startsWith('mount-blob:')
        ) {
          targets.push({ fileRow: mainRow, kind: 'main' });
        }
        for (const row of findHistoryFileRows(mainDb, character.id, character.defaultImageId)) {
          targets.push({ fileRow: row, kind: 'history' });
        }
        if (targets.length === 0) continue;

        ensureFolderPath(mountDbConn, vaultId, 'images');
        ensureFolderPath(mountDbConn, vaultId, HISTORY_FOLDER);

        let charImported = 0;
        for (const target of targets) {
          try {
            const sourcePath = storageKeyToAbsolutePath(filesDir, target.fileRow.storageKey);
            if (!sourcePath || !fs.existsSync(sourcePath)) {
              skipped++;
              logger.warn('Avatar source missing on disk; leaving files row in place', {
                context: `migration.${MIGRATION_ID}`,
                characterId: character.id,
                fileEntryId: target.fileRow.id,
                storageKey: target.fileRow.storageKey,
              });
              continue;
            }

            const bytes = await fsPromises.readFile(sourcePath);
            const sha = sha256Buffer(bytes);
            if (target.fileRow.sha256 && target.fileRow.sha256 !== sha) {
              skipped++;
              logger.warn('sha256 mismatch — leaving files row in place', {
                context: `migration.${MIGRATION_ID}`,
                characterId: character.id,
                fileEntryId: target.fileRow.id,
                expectedSha: target.fileRow.sha256.slice(0, 8),
                actualSha: sha.slice(0, 8),
              });
              continue;
            }

            const originalName = sanitizeLeafName(
              target.fileRow.originalFilename || path.basename(sourcePath)
            );

            let relativePath: string;
            let folderId: string | null;
            if (target.kind === 'main') {
              relativePath = MAIN_AVATAR_PATH;
              folderId = ensureFolderPath(mountDbConn, vaultId, 'images');
              // Delete any existing blob+file at the canonical main path
              const existingFile = findFileByPath.get(vaultId, relativePath) as { id: string } | undefined;
              if (existingFile) {
                if (chunksTableExists) {
                  try { deleteChunksByFile.run(existingFile.id); } catch { /* ignore */ }
                }
                deleteFileById.run(existingFile.id);
              }
              deleteBlobByPath.run(vaultId, relativePath);
            } else {
              folderId = ensureFolderPath(mountDbConn, vaultId, HISTORY_FOLDER);
              let candidate = `${HISTORY_FOLDER}/${originalName}`;
              for (let attempt = 2; attempt <= 999; attempt++) {
                const existing = findBlobByPath.get(vaultId, candidate) as { id: string } | undefined;
                if (!existing) break;
                const ext = path.extname(originalName);
                const stem = path.basename(originalName, ext);
                candidate = `${HISTORY_FOLDER}/${stem} (${attempt})${ext}`;
              }
              relativePath = candidate;
            }

            const blobId = randomUUID();
            const fileMirrorId = randomUUID();
            const now = nowIso();
            const originalMime = target.fileRow.mimeType || 'image/webp';
            insertBlob.run(
              blobId,
              vaultId,
              relativePath,
              originalName || path.basename(relativePath),
              originalMime,
              originalMime,
              bytes.length,
              sha,
              '',
              bytes,
              now,
              now
            );
            insertFile.run(
              fileMirrorId,
              vaultId,
              relativePath,
              path.posix.basename(relativePath),
              sha,
              bytes.length,
              now,
              folderId,
              now,
              now
            );

            updateFileEntry.run(
              `mount-blob:${vaultId}:${blobId}`,
              now,
              target.fileRow.id
            );

            await archiveSourceFile(filesDir, sourcePath, target.fileRow.originalFilename);
            archivedFiles++;

            if (target.kind === 'main') importedMain++;
            else importedHistory++;
            charImported++;
          } catch (err) {
            errors++;
            logger.error('Failed to import character avatar', {
              context: `migration.${MIGRATION_ID}`,
              characterId: character.id,
              characterName: character.name,
              fileEntryId: target.fileRow.id,
              storageKey: target.fileRow.storageKey,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (charImported > 0) {
          updateMountTotals.run(vaultId, vaultId, nowIso(), vaultId);
          logger.info('Imported avatars for character', {
            context: `migration.${MIGRATION_ID}`,
            characterId: character.id,
            characterName: character.name,
            count: charImported,
          });
        }
      }

      const message = `Imported ${importedMain} main + ${importedHistory} history avatars across ${characters.length} character(s); archived ${archivedFiles} on-disk file(s); skipped ${skipped}, errors ${errors}`;
      logger.info(message, { context: `migration.${MIGRATION_ID}` });

      return {
        id: MIGRATION_ID,
        success: errors === 0,
        itemsAffected: importedMain + importedHistory,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('migrate-character-avatars-to-vaults migration aborted', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: importedMain + importedHistory,
        message: 'migrate-character-avatars-to-vaults migration aborted',
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
