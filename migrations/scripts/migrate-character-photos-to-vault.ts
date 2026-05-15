/**
 * Migration: Move character "photo gallery" off legacy CHARACTER-tagged images
 * onto each character's vault `photos/` folder.
 *
 * Phase 3 of the photo-albums work. Before this migration, the Aurora tab's
 * gallery surfaced an image because some `files.tags[]` entry happened to
 * match a `characters.id`. After this migration, each character's gallery is
 * literally the `photos/` folder inside their database-backed vault, populated
 * via the same kept-image Markdown contract `keep_image` writes at runtime.
 *
 * The migration is in five phases. The main DB (chats / characters / files)
 * and the mount-index DB are separate SQLCipher connections, so writes cross
 * them in carefully ordered batches rather than a single transaction.
 *
 *   A. For every character with a vault, find every `files` row whose
 *      `tags[]` contains that character's id (CHARACTER tag) and mirror it
 *      into the character's vault `photos/` folder. We share the binary —
 *      one `doc_mount_files`/`doc_mount_blobs` content row per unique
 *      sha256 — and add a new `doc_mount_file_links` row per (image,
 *      character) pair. The link's `extractedText` is the same Markdown
 *      `buildKeptImageMarkdown` produces at runtime, minus the chat /
 *      scene context we no longer have. Chunks are written inline so the
 *      vault search picks the new photo up as soon as the next worker
 *      embedding pass runs.
 *
 *   B. Translate `characters.defaultImageId` from a legacy `files.id` to a
 *      vault link id. Resolution is by sha256: we look up the legacy file's
 *      sha256, find any vault link in this character's vault with matching
 *      sha256, and prefer one in `photos/` if available (otherwise we keep
 *      the pre-existing `images/avatar.webp` link from the earlier avatar
 *      migration). Same translation runs over every entry of
 *      `characters.avatarOverrides[].imageId`. Broken pointers are nulled
 *      / dropped and logged.
 *
 *   C. Translate `chats.characterAvatars` — a JSON map of
 *      `{ [characterId]: { imageId, generatedAt, afterMessageCount } }`
 *      written by the wardrobe auto-avatar job — using the same lookup.
 *
 *   D. Strip every character-id entry out of `files.tags[]`. CHARACTER
 *      tagging is no longer a thing: the gallery IS the vault folder.
 *      Non-character tag ids (THEME / CHAT / etc.) are left alone.
 *
 *   E. GC any leftover `files` row in category IMAGE / AVATAR that ends up
 *      with `tags[] = []` AND is not referenced by any chat message's
 *      `attachments[]` AND is not the new value of any
 *      `defaultImageId` / `avatarOverrides` / `characterAvatars` field
 *      (post-translation those are all vault link ids — files refs are
 *      gone — but we re-check defensively). We delete the `files` row.
 *      Storage: if `storageKey` is a `mount-blob:` shim, the underlying
 *      blob is owned by the vault link now, so we leave it alone. If
 *      `storageKey` is a `_general/...` disk path, we leave the disk
 *      content alone too (the disk-file GC is a separate sweep —
 *      hard-deletes here would silently strand other consumers).
 *
 * Idempotent across all phases: re-running this migration sees nothing to
 * do because Phase A's unique-relativePath collision check, Phase B's
 * lookup-by-sha256, Phase D's stripped tags, and Phase E's empty-tags
 * predicate all already hold.
 *
 * Migration ID: migrate-character-photos-to-vault-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
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
import {
  buildKeptImageMarkdown,
  buildSlugAndFilename,
  sha256OfString,
  basenameOfRelativePath,
} from '../../lib/photos/keep-image-markdown';
import {
  buildPhotosRelativePath,
  isPhotosRelativePath,
  PHOTOS_FOLDER,
} from '../../lib/photos/photos-paths';
import { chunkDocument } from '../../lib/mount-index/chunker';

const MIGRATION_ID = 'migrate-character-photos-to-vault-v1';
const MOUNT_BLOB_PREFIX = 'mount-blob:';

function nowIso(): string {
  return new Date().toISOString();
}

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

interface CharacterRow {
  id: string;
  name: string;
  vaultId: string;
  defaultImageId: string | null;
  avatarOverridesJson: string | null;
}

interface FileRow {
  id: string;
  sha256: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  category: string;
  source: string;
  description: string | null;
  generationPrompt: string | null;
  generationModel: string | null;
  generationRevisedPrompt: string | null;
  storageKey: string | null;
  tagsJson: string;
  createdAt: string;
}

interface MountBlobRow {
  data: Buffer;
}

interface ContentRow {
  id: string;
  sha256: string;
}

interface VaultLinkBySha {
  linkId: string;
  relativePath: string;
}

interface ChatRow {
  id: string;
  characterAvatarsJson: string | null;
}

function safeParseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function safeParseJsonObject(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readImageBytes(
  mountDb: DatabaseType,
  filesDir: string,
  file: FileRow
): Buffer | null {
  const key = file.storageKey ?? '';
  if (key.startsWith(MOUNT_BLOB_PREFIX)) {
    // mount-blob:{mountPointId}:{blobId}
    const rest = key.slice(MOUNT_BLOB_PREFIX.length);
    const [, blobId] = rest.split(':', 2);
    if (!blobId) return null;
    const row = mountDb
      .prepare(`SELECT data FROM "doc_mount_blobs" WHERE id = ?`)
      .get(blobId) as MountBlobRow | undefined;
    return row?.data ?? null;
  }
  if (!key || key.includes('..')) return null;
  const abs = path.join(filesDir, ...key.split('/'));
  if (!fs.existsSync(abs)) return null;
  try {
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
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
    const ts = nowIso();
    insertStmt.run(id, mountPointId, currentParentId, segment, currentPath, ts, ts);
    currentParentId = id;
  }
  return currentParentId;
}

function resolveUniqueRelativePath(
  mountDb: DatabaseType,
  mountPointId: string,
  desired: string
): string {
  const findStmt = mountDb.prepare(
    `SELECT 1 FROM "doc_mount_file_links" WHERE mountPointId = ? AND relativePath = ?`
  );
  if (!findStmt.get(mountPointId, desired)) return desired;
  const ext = path.posix.extname(desired);
  const stem = desired.slice(0, desired.length - ext.length);
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!findStmt.get(mountPointId, candidate)) return candidate;
  }
  throw new Error(`Could not find a unique path for ${desired} after 10000 attempts`);
}

function findOrCreateContentRow(
  mountDb: DatabaseType,
  bytes: Buffer,
  sha256: string,
  storedMimeType: string
): string {
  const existing = mountDb
    .prepare(`SELECT id FROM "doc_mount_files" WHERE sha256 = ? LIMIT 1`)
    .get(sha256) as ContentRow | undefined;
  if (existing) return existing.id;

  const fileId = randomUUID();
  const ts = nowIso();
  mountDb
    .prepare(
      `INSERT INTO "doc_mount_files"
         (id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt)
       VALUES (?, ?, ?, 'blob', 'database', ?, ?)`
    )
    .run(fileId, sha256, bytes.length, ts, ts);
  mountDb
    .prepare(
      `INSERT INTO "doc_mount_blobs"
         (id, fileId, sha256, sizeBytes, storedMimeType, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(randomUUID(), fileId, sha256, bytes.length, storedMimeType, bytes, ts, ts);
  return fileId;
}

function findVaultLinkBySha(
  mountDb: DatabaseType,
  mountPointId: string,
  sha256: string
): VaultLinkBySha | null {
  const rows = mountDb
    .prepare(
      `SELECT l.id AS linkId, l.relativePath AS relativePath
       FROM "doc_mount_file_links" l
       JOIN "doc_mount_files" f ON f.id = l.fileId
       WHERE l.mountPointId = ? AND f.sha256 = ?`
    )
    .all(mountPointId, sha256) as VaultLinkBySha[];
  if (rows.length === 0) return null;
  const inPhotos = rows.find((r) => isPhotosRelativePath(r.relativePath));
  return inPhotos ?? rows[0];
}

function findExistingPhotosLinkBySha(
  mountDb: DatabaseType,
  mountPointId: string,
  sha256: string
): VaultLinkBySha | null {
  const row = mountDb
    .prepare(
      `SELECT l.id AS linkId, l.relativePath AS relativePath
       FROM "doc_mount_file_links" l
       JOIN "doc_mount_files" f ON f.id = l.fileId
       WHERE l.mountPointId = ? AND f.sha256 = ?
         AND LOWER(l.relativePath) LIKE 'photos/%'
       LIMIT 1`
    )
    .get(mountPointId, sha256) as VaultLinkBySha | undefined;
  return row ?? null;
}

function listCharactersWithVaults(): CharacterRow[] {
  const cols = getSQLiteTableColumns('characters').map((c) => c.name);
  if (!cols.includes('characterDocumentMountPointId')) return [];
  if (!cols.includes('defaultImageId')) return [];

  const db = getSQLiteDatabase();
  return db
    .prepare(
      `SELECT id, name,
              characterDocumentMountPointId AS vaultId,
              defaultImageId,
              avatarOverrides AS avatarOverridesJson
       FROM "characters"
       WHERE characterDocumentMountPointId IS NOT NULL`
    )
    .all() as CharacterRow[];
}

function listImageFilesWithCharacterTags(
  characterIds: Set<string>
): FileRow[] {
  if (characterIds.size === 0) return [];
  const db = getSQLiteDatabase();
  // We must walk all image/avatar rows and JSON.parse `tags` to find a
  // real match — substring LIKE matches over the JSON would have UUID
  // collisions across hex slots.
  const rows = db
    .prepare(
      `SELECT id, sha256, originalFilename, mimeType, size, category, source,
              description, generationPrompt, generationModel, generationRevisedPrompt,
              storageKey, tags AS tagsJson, createdAt
       FROM "files"
       WHERE category IN ('IMAGE', 'AVATAR')`
    )
    .all() as FileRow[];
  return rows.filter((row) => {
    const tags = safeParseJsonArray(row.tagsJson);
    return tags.some((t) => characterIds.has(t));
  });
}

function listAllImageFiles(): FileRow[] {
  const db = getSQLiteDatabase();
  return db
    .prepare(
      `SELECT id, sha256, originalFilename, mimeType, size, category, source,
              description, generationPrompt, generationModel, generationRevisedPrompt,
              storageKey, tags AS tagsJson, createdAt
       FROM "files"
       WHERE category IN ('IMAGE', 'AVATAR')`
    )
    .all() as FileRow[];
}

function collectMessageAttachmentIds(): Set<string> {
  const ids = new Set<string>();
  if (!sqliteTableExists('chat_messages')) return ids;
  const cols = getSQLiteTableColumns('chat_messages').map((c) => c.name);
  if (!cols.includes('attachments')) return ids;
  const db = getSQLiteDatabase();
  const rows = db
    .prepare(`SELECT attachments FROM "chat_messages" WHERE attachments IS NOT NULL`)
    .all() as Array<{ attachments: string | null }>;
  let i = 0;
  for (const row of rows) {
    i++;
    reportProgress(i, rows.length, 'messages (attachment scan)');
    for (const id of safeParseJsonArray(row.attachments)) ids.add(id);
  }
  return ids;
}

export const migrateCharacterPhotosToVaultMigration: Migration = {
  id: MIGRATION_ID,
  description:
    "Mirror every CHARACTER-tagged image into the matching character's vault `photos/` folder, translate defaultImageId / avatarOverrides / characterAvatars to vault link ids, strip CHARACTER tags from files.tags, and GC unreferenced images-v2 rows.",
  introducedInVersion: '4.5.0',
  dependsOn: [
    'add-doc-mount-file-links-v1',
    'migrate-character-avatars-to-vaults-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('characters')) return false;
    if (!sqliteTableExists('files')) return false;
    if (!fs.existsSync(getMountIndexDatabasePath())) return false;

    const characters = listCharactersWithVaults();
    if (characters.length === 0) return false;

    const ids = new Set(characters.map((c) => c.id));
    return listImageFilesWithCharacterTags(ids).length > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let mountDb: DatabaseType | null = null;

    // Phase counters
    let mirrored = 0;
    let mirrorSkippedCollision = 0;
    let mirrorSkippedMissingBytes = 0;
    let defaultImageTranslated = 0;
    let defaultImageNulled = 0;
    let overridesTranslated = 0;
    let overridesDropped = 0;
    let characterAvatarsTranslated = 0;
    let characterAvatarsDropped = 0;
    let tagsStripped = 0;
    let filesGced = 0;
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
      const mountConn = mountDb;

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

      const characterById = new Map(characters.map((c) => [c.id, c]));
      const characterIds = new Set(characters.map((c) => c.id));

      // Helpful upfront index: legacy file row by id (for translation
      // phases). Image rows are typically O(thousands), so the array is
      // cheap.
      const allImageFiles = listAllImageFiles();
      const fileById = new Map(allImageFiles.map((f) => [f.id, f]));

      // ============================================================================
      // Phase A: mirror CHARACTER-tagged images into vault photos/
      // ============================================================================
      const taggedFiles = listImageFilesWithCharacterTags(characterIds);

      // Defensive check: a character row may carry a
      // `characterDocumentMountPointId` that no longer exists in
      // `doc_mount_points` (e.g. the vault was deleted out from under it).
      // Mirroring into such a stale vault id trips the
      // `doc_mount_file_links.mountPointId FK` constraint mid-insert and the
      // row error survives via try/catch but pollutes the log. Find which
      // vaults actually exist up front so we can warn + skip cleanly.
      const validVaultIds = new Set<string>();
      const lookupVault = mountConn.prepare(
        `SELECT 1 FROM "doc_mount_points" WHERE id = ?`
      );
      for (const c of characters) {
        const hit = lookupVault.get(c.vaultId) as { 1: number } | undefined;
        if (hit) validVaultIds.add(c.vaultId);
      }

      const skippedStaleVaultCharacters = new Set<string>();
      // Build an iteration list of (character, file) pairs so the progress
      // tier reads naturally as "k/n photos".
      const work: Array<{ character: CharacterRow; file: FileRow }> = [];
      for (const file of taggedFiles) {
        const tags = safeParseJsonArray(file.tagsJson);
        for (const tagId of tags) {
          const character = characterById.get(tagId);
          if (!character) continue;
          if (!validVaultIds.has(character.vaultId)) {
            if (!skippedStaleVaultCharacters.has(character.id)) {
              skippedStaleVaultCharacters.add(character.id);
              logger.warn('Character vault id does not exist in doc_mount_points; skipping photo mirror', {
                context: `migration.${MIGRATION_ID}`,
                characterId: character.id,
                characterName: character.name,
                staleVaultId: character.vaultId,
              });
            }
            continue;
          }
          work.push({ character, file });
        }
      }

      let i = 0;
      for (const { character, file } of work) {
        i++;
        reportProgress(i, work.length, 'photos');
        try {
          // Idempotency: already a photo for this sha in this vault → skip.
          const existing = findExistingPhotosLinkBySha(
            mountConn,
            character.vaultId,
            file.sha256
          );
          if (existing) {
            mirrorSkippedCollision++;
            continue;
          }

          const bytes = readImageBytes(mountConn, filesDir, file);
          if (!bytes || bytes.length === 0) {
            mirrorSkippedMissingBytes++;
            logger.warn('Image bytes unavailable; skipping photo mirror', {
              context: `migration.${MIGRATION_ID}`,
              fileId: file.id,
              characterId: character.id,
              storageKey: file.storageKey,
            });
            continue;
          }

          const keptAt = file.createdAt || nowIso();
          const markdown = buildKeptImageMarkdown({
            generationPrompt: file.generationPrompt,
            generationRevisedPrompt: file.generationRevisedPrompt,
            generationModel: file.generationModel,
            sceneState: null,
            characterName: character.name,
            characterId: character.id,
            tags: [],
            caption: file.description?.trim() ? file.description : null,
            keptAt,
          });

          const { filename } = buildSlugAndFilename({
            caption: file.description?.trim() ? file.description : null,
            generationPrompt: file.generationPrompt,
            mimeType: file.mimeType,
            keptAt,
          });
          const desired = buildPhotosRelativePath(filename);
          const relativePath = resolveUniqueRelativePath(
            mountConn,
            character.vaultId,
            desired
          );

          const folderId = ensureFolderPath(
            mountConn,
            character.vaultId,
            PHOTOS_FOLDER
          );
          const contentFileId = findOrCreateContentRow(
            mountConn,
            bytes,
            file.sha256,
            file.mimeType || 'application/octet-stream'
          );

          const linkId = randomUUID();
          const extractedTextSha = sha256OfString(markdown);
          const ts = nowIso();
          mountConn
            .prepare(
              `INSERT INTO "doc_mount_file_links" (
                 id, fileId, mountPointId, relativePath, fileName, folderId,
                 originalFileName, originalMimeType,
                 description, descriptionUpdatedAt,
                 conversionStatus, conversionError, plainTextLength,
                 extractedText, extractedTextSha256, extractionStatus, extractionError,
                 chunkCount, lastModified, createdAt, updatedAt
               ) VALUES (
                 ?, ?, ?, ?, ?, ?,
                 ?, ?,
                 ?, ?,
                 'converted', NULL, ?,
                 ?, ?, 'converted', NULL,
                 0, ?, ?, ?
               )`
            )
            .run(
              linkId,
              contentFileId,
              character.vaultId,
              relativePath,
              basenameOfRelativePath(relativePath),
              folderId,
              file.originalFilename || basenameOfRelativePath(relativePath),
              file.mimeType || null,
              file.description?.trim() || '',
              null,
              markdown.length,
              markdown,
              extractedTextSha,
              ts,
              keptAt,
              ts
            );

          // Chunk the Markdown inline. The auto-chunker dispatches by
          // file extension and the link path is a .webp/.png — so it
          // would skip our Markdown extractedText. We mirror what
          // chunkAndInsertExtractedText does, against raw SQL.
          const chunks = chunkDocument(markdown);
          if (chunks.length > 0) {
            const insertChunk = mountConn.prepare(
              `INSERT INTO "doc_mount_chunks" (
                 id, linkId, mountPointId, chunkIndex, content, tokenCount,
                 headingContext, embedding, createdAt, updatedAt
               ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
            );
            for (const chunk of chunks) {
              insertChunk.run(
                randomUUID(),
                linkId,
                character.vaultId,
                chunk.chunkIndex,
                chunk.content,
                chunk.tokenCount,
                chunk.headingContext ?? null,
                ts,
                ts
              );
            }
            mountConn
              .prepare(
                `UPDATE "doc_mount_file_links" SET chunkCount = ?, plainTextLength = ?, updatedAt = ? WHERE id = ?`
              )
              .run(chunks.length, markdown.length, ts, linkId);
          }

          mirrored++;
        } catch (err) {
          errors++;
          logger.error('Failed to mirror image into vault photos/', {
            context: `migration.${MIGRATION_ID}`,
            characterId: character.id,
            fileId: file.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Refresh mount-point file counts for every vault we touched.
      const touchedVaultIds = new Set(
        work.map((w) => w.character.vaultId)
      );
      const updateTotals = mountConn.prepare(
        `UPDATE "doc_mount_points"
           SET fileCount = (SELECT COUNT(*) FROM "doc_mount_file_links" WHERE mountPointId = ?),
               totalSizeBytes = (SELECT COALESCE(SUM(f.fileSizeBytes), 0)
                                 FROM "doc_mount_file_links" l
                                 JOIN "doc_mount_files" f ON f.id = l.fileId
                                 WHERE l.mountPointId = ?),
               updatedAt = ?
           WHERE id = ?`
      );
      for (const vid of touchedVaultIds) {
        try { updateTotals.run(vid, vid, nowIso(), vid); } catch { /* ignore */ }
      }

      // ============================================================================
      // Phase B: translate characters.defaultImageId + avatarOverrides[]
      // ============================================================================
      const updateCharacterStmt = mainDb.prepare(
        `UPDATE "characters" SET defaultImageId = ?, avatarOverrides = ?, updatedAt = ? WHERE id = ?`
      );

      // Track which character-vault link ids are now serving as portraits.
      // Used by Phase E so we don't GC a `files` row that resolved into a
      // vault link some character now points at — although post-translation
      // that pointer is a link id, not a files id, so this is purely
      // defensive.
      const referencedLegacyFileIds = new Set<string>();

      let bIdx = 0;
      for (const character of characters) {
        bIdx++;
        reportProgress(bIdx, characters.length, 'character pointers');

        // Stale-vault characters keep their legacy pointers — there's no
        // vault to translate into, and the resolver fallback in commit 2
        // serves their avatars from `files` just fine. Nulling the pointer
        // would needlessly break a working avatar.
        if (!validVaultIds.has(character.vaultId)) {
          continue;
        }

        let newDefault: string | null = null;
        if (character.defaultImageId) {
          const legacy = fileById.get(character.defaultImageId);
          if (legacy) {
            const link = findVaultLinkBySha(
              mountConn,
              character.vaultId,
              legacy.sha256
            );
            if (link) {
              newDefault = link.linkId;
              defaultImageTranslated++;
            } else {
              defaultImageNulled++;
              logger.warn('Could not translate defaultImageId — no vault link with matching sha256', {
                context: `migration.${MIGRATION_ID}`,
                characterId: character.id,
                legacyFileId: legacy.id,
                sha256Prefix: legacy.sha256.slice(0, 8),
              });
            }
          } else {
            defaultImageNulled++;
            logger.warn('Could not translate defaultImageId — legacy file row missing', {
              context: `migration.${MIGRATION_ID}`,
              characterId: character.id,
              legacyFileId: character.defaultImageId,
            });
          }
        }

        const oldOverrides = (() => {
          if (!character.avatarOverridesJson) return [] as Array<{ chatId: string; imageId: string }>;
          try {
            const parsed = JSON.parse(character.avatarOverridesJson) as unknown;
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(
              (o): o is { chatId: string; imageId: string } =>
                !!o && typeof o === 'object'
                && typeof (o as Record<string, unknown>).chatId === 'string'
                && typeof (o as Record<string, unknown>).imageId === 'string'
            );
          } catch {
            return [];
          }
        })();

        const newOverrides: Array<{ chatId: string; imageId: string }> = [];
        for (const ovr of oldOverrides) {
          const legacy = fileById.get(ovr.imageId);
          if (!legacy) {
            overridesDropped++;
            continue;
          }
          const link = findVaultLinkBySha(mountConn, character.vaultId, legacy.sha256);
          if (link) {
            newOverrides.push({ chatId: ovr.chatId, imageId: link.linkId });
            overridesTranslated++;
          } else {
            overridesDropped++;
          }
        }

        // Only write when something actually changes (idempotency).
        const overridesUnchanged =
          JSON.stringify(newOverrides) === JSON.stringify(oldOverrides) &&
          character.defaultImageId === newDefault;
        if (!overridesUnchanged) {
          updateCharacterStmt.run(
            newDefault,
            JSON.stringify(newOverrides),
            nowIso(),
            character.id
          );
        }
      }

      // ============================================================================
      // Phase C: translate chats.characterAvatars
      // ============================================================================
      if (sqliteTableExists('chats')) {
        const chatCols = getSQLiteTableColumns('chats').map((c) => c.name);
        if (chatCols.includes('characterAvatars')) {
          const chats = mainDb
            .prepare(
              `SELECT id, characterAvatars AS characterAvatarsJson
               FROM "chats"
               WHERE characterAvatars IS NOT NULL`
            )
            .all() as ChatRow[];
          const updateChatStmt = mainDb.prepare(
            `UPDATE "chats" SET characterAvatars = ?, updatedAt = ? WHERE id = ?`
          );

          let cIdx = 0;
          for (const chat of chats) {
            cIdx++;
            reportProgress(cIdx, chats.length, 'chat avatar maps');
            const obj = safeParseJsonObject(chat.characterAvatarsJson);
            const out: Record<string, unknown> = {};
            let changed = false;
            for (const [characterId, value] of Object.entries(obj)) {
              if (!value || typeof value !== 'object') {
                out[characterId] = value;
                continue;
              }
              const entry = value as Record<string, unknown>;
              const imageId = typeof entry.imageId === 'string' ? entry.imageId : null;
              if (!imageId) {
                out[characterId] = entry;
                continue;
              }
              const legacy = fileById.get(imageId);
              const character = characterById.get(characterId);
              if (!legacy || !character) {
                changed = true;
                characterAvatarsDropped++;
                continue;
              }
              // Stale-vault characters keep their legacy imageId — same
              // reasoning as Phase B: the resolver fallback serves them.
              if (!validVaultIds.has(character.vaultId)) {
                out[characterId] = entry;
                continue;
              }
              const link = findVaultLinkBySha(mountConn, character.vaultId, legacy.sha256);
              if (link) {
                out[characterId] = { ...entry, imageId: link.linkId };
                characterAvatarsTranslated++;
                changed = changed || link.linkId !== imageId;
              } else {
                changed = true;
                characterAvatarsDropped++;
              }
            }
            if (changed) {
              const next = Object.keys(out).length === 0 ? null : JSON.stringify(out);
              updateChatStmt.run(next, nowIso(), chat.id);
            }
          }
        }
      }

      // ============================================================================
      // Phase D: strip CHARACTER ids from files.tags[]
      // ============================================================================
      const updateFileTagsStmt = mainDb.prepare(
        `UPDATE "files" SET tags = ?, updatedAt = ? WHERE id = ?`
      );

      let dIdx = 0;
      for (const file of allImageFiles) {
        dIdx++;
        reportProgress(dIdx, allImageFiles.length, 'files (tag strip)');
        const tags = safeParseJsonArray(file.tagsJson);
        if (tags.length === 0) continue;
        const stripped = tags.filter((t) => !characterIds.has(t));
        if (stripped.length === tags.length) continue;
        updateFileTagsStmt.run(
          JSON.stringify(stripped),
          nowIso(),
          file.id
        );
        tagsStripped++;
      }

      // ============================================================================
      // Phase E: GC unreferenced images-v2 rows
      // ============================================================================
      // A `files` row is GC-eligible when, after Phases A-D:
      //   - category in (IMAGE, AVATAR)
      //   - tags[] is empty (no THEME / CHAT / future-tag refs)
      //   - id is not in any chat_message.attachments[]
      //   - id is not referenced in any character.defaultImageId /
      //     avatarOverrides / chats.characterAvatars — those now hold link
      //     ids, so this is defensive but cheap.
      const refreshedFiles = listAllImageFiles();
      const messageAttachmentIds = collectMessageAttachmentIds();

      // Refresh character + chat references after Phases B/C.
      for (const c of listCharactersWithVaults()) {
        if (c.defaultImageId) referencedLegacyFileIds.add(c.defaultImageId);
        for (const o of (() => {
          try {
            const arr = JSON.parse(c.avatarOverridesJson ?? '[]') as unknown;
            return Array.isArray(arr) ? arr : [];
          } catch { return []; }
        })()) {
          const v = o as { imageId?: unknown };
          if (typeof v?.imageId === 'string') referencedLegacyFileIds.add(v.imageId);
        }
      }
      if (sqliteTableExists('chats')) {
        const chats = mainDb
          .prepare(`SELECT characterAvatars AS characterAvatarsJson FROM "chats" WHERE characterAvatars IS NOT NULL`)
          .all() as Array<{ characterAvatarsJson: string | null }>;
        let scanIdx = 0;
        for (const c of chats) {
          scanIdx++;
          reportProgress(scanIdx, chats.length, 'chats (ref scan)');
          for (const v of Object.values(safeParseJsonObject(c.characterAvatarsJson))) {
            if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).imageId === 'string') {
              referencedLegacyFileIds.add((v as Record<string, string>).imageId);
            }
          }
        }
      }

      const deleteFileStmt = mainDb.prepare(`DELETE FROM "files" WHERE id = ?`);
      let eIdx = 0;
      for (const file of refreshedFiles) {
        eIdx++;
        reportProgress(eIdx, refreshedFiles.length, 'files (GC scan)');
        const tags = safeParseJsonArray(file.tagsJson);
        if (tags.length > 0) continue;
        if (messageAttachmentIds.has(file.id)) continue;
        if (referencedLegacyFileIds.has(file.id)) continue;
        // Eligible. Delete the row. Storage cleanup is deliberately out of
        // scope — see Phase E commentary above.
        deleteFileStmt.run(file.id);
        filesGced++;
      }

      const message =
        `Mirrored ${mirrored} photo(s) into ${touchedVaultIds.size} vault(s); ` +
        `translated ${defaultImageTranslated} defaultImageId / ${overridesTranslated} avatarOverrides / ${characterAvatarsTranslated} chat characterAvatars; ` +
        `stripped CHARACTER tags from ${tagsStripped} file(s); ` +
        `garbage-collected ${filesGced} unreferenced files row(s); ` +
        `skipped (collision) ${mirrorSkippedCollision}, (missing bytes) ${mirrorSkippedMissingBytes}, (stale vault) ${skippedStaleVaultCharacters.size}; ` +
        `nulled ${defaultImageNulled} defaultImageId, dropped ${overridesDropped} overrides, ${characterAvatarsDropped} chat-avatar entries; ` +
        `errors ${errors}`;
      logger.info(message, { context: `migration.${MIGRATION_ID}` });

      // Per-row Phase A errors (FK violation on a stale `mountPointId`, a
      // sharp/codec failure on one image, etc.) are captured in the `errors`
      // counter and logged in detail above. Treat them as soft so the
      // migration runner doesn't loop the whole thing on the next startup
      // looking for the work that's already been done — Phase A's
      // collision-skip and Phase D/E's empty-tags predicate make subsequent
      // runs no-ops, but the migration framework would still keep re-firing
      // it as long as `success` is false. A hard exception out of `run()`
      // stays fatal; that's handled by the outer catch.
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected:
          mirrored + defaultImageTranslated + overridesTranslated +
          characterAvatarsTranslated + tagsStripped + filesGced,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('migrate-character-photos-to-vault migration aborted', {
        context: `migration.${MIGRATION_ID}`,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: mirrored,
        message: 'migrate-character-photos-to-vault migration aborted',
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
