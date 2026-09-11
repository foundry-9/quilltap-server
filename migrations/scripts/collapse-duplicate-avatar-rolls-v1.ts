/**
 * Migration: Collapse Duplicate Avatar Rolls
 *
 * Brings existing avatars into the configuration cache
 * (`docs/developer/features/avatar-configuration-cache.md`): one image per
 * character per configuration, instead of a fresh provider call — and a fresh
 * stored image — every time a character put the same coat back on.
 *
 * Pre-cache rows cannot reproduce the full-fidelity key: the LoRAs and stored
 * profile options in force at generation time are recorded nowhere. They get
 * the v0 key derived from `(generationModel, generationPrompt)` instead, which
 * is exactly what this migration groups on. The `v` discriminator in the key
 * format means a v0 key can never collide with a v1 one.
 *
 * Per group:
 *
 *   - survivor = newest `createdAt`; it receives the v0 `generationKey`;
 *   - every reference to a non-survivor is repointed to the survivor:
 *     `chats.characterAvatars`, `characters.avatarOverrides`, and
 *     `chat_messages.attachments`;
 *   - the Lantern announcement that attached a deleted roll quotes its uuid
 *     inline ("catalogued under uuid `…`"), so that uuid is substituted in
 *     `content` and `opaqueContent` too. A mechanical id swap, not a rewrite:
 *     without it the message names a file that no longer exists, to the reader
 *     and to any model that later reads the transcript;
 *   - non-survivors are then deleted — the `files` row, and in the mount-index
 *     DB the chunks, links, and (when that was the last link for the file) the
 *     `doc_mount_files`, `doc_mount_blobs` and `doc_mount_documents` rows.
 *     Explicitly, not via `ON DELETE CASCADE`: tables generated from the Zod
 *     schema carry no foreign keys at all.
 *
 * A group of one keeps its row and gains a key — including rows no chat
 * references any more. An orphaned roll is a perfectly good cache entry for its
 * configuration, and keeping it means the next chat to wear that outfit costs
 * nothing.
 *
 * **This is destructive and visible.** The duplicates are not redundant bytes;
 * they are different seeds of one prompt. Chats that displayed an older roll
 * now display the survivor, irreversibly. Measured on the instance this was
 * written against: 1786 avatar rows / 282 MB collapsing to 889 survivors,
 * freeing roughly 141 MB of `quilltap-mount-index.db`.
 *
 * Resumable rather than transactional: grouping reads every avatar row
 * regardless of whether it is already keyed, so a re-run after an interrupted
 * pass picks the same survivor and finishes the work that remains.
 *
 * Migration ID: collapse-duplicate-avatar-rolls-v1
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
  openMountIndexDbIfPresent,
} from '../lib/database-utils';
import { deriveLegacyAvatarCacheKey } from '../../lib/wardrobe/avatar-cache';

const MIGRATION_ID = 'collapse-duplicate-avatar-rolls-v1';

/** Matches what the avatar handler names its output: `avatar_<Name>_<ts>.webp`. */
const AVATAR_FILENAME_PREDICATE = `originalFilename LIKE 'avatar\\_%' ESCAPE '\\'`;

interface AvatarRow {
  id: string;
  generationPrompt: string | null;
  generationModel: string | null;
  generationKey: string | null;
  storageKey: string | null;
  createdAt: string;
}

function selectAvatarRows(db: DatabaseType): AvatarRow[] {
  return db
    .prepare(
      `SELECT id, generationPrompt, generationModel, generationKey, storageKey, createdAt
         FROM files
        WHERE ${AVATAR_FILENAME_PREDICATE}
          AND category = 'IMAGE'
          AND generationPrompt IS NOT NULL
          AND generationPrompt != ''`
    )
    .all() as AvatarRow[];
}

/** `mount-blob:<mountPointId>:<blobId>` → blobId, or null for any other shape. */
function blobIdFromStorageKey(storageKey: string | null): string | null {
  if (!storageKey || !storageKey.startsWith('mount-blob:')) return null;
  const rest = storageKey.slice('mount-blob:'.length);
  const sep = rest.indexOf(':');
  if (sep < 1 || sep === rest.length - 1) return null;
  return rest.slice(sep + 1);
}

/**
 * Blob ids that a character still names as its portrait (`defaultImageId` is a
 * vault *link* id, so this resolves link → file → blob).
 *
 * The canonical `images/avatar.webp` portrait is a different path from the
 * history rolls collapsed here and is never ours to delete. A row backed by one
 * of these blobs is therefore excluded from the victim list outright rather
 * than skipped at deletion time — skipping late would either strand a `files`
 * row whose bytes survived, or leave it unkeyed and re-trigger this migration
 * on every startup.
 */
function protectedBlobIds(db: DatabaseType, mountDb: DatabaseType | null): Set<string> {
  if (!mountDb) return new Set();

  const linkIds = (
    db
      .prepare(
        "SELECT defaultImageId AS linkId FROM characters WHERE defaultImageId IS NOT NULL AND defaultImageId != ''"
      )
      .all() as Array<{ linkId: string }>
  ).map((r) => r.linkId);

  const protectedIds = new Set<string>();
  const blobsForLink = mountDb.prepare(
    `SELECT b.id AS blobId
       FROM doc_mount_file_links l
       JOIN doc_mount_blobs b ON b.fileId = l.fileId
      WHERE l.id = ?`
  );
  for (const linkId of linkIds) {
    for (const row of blobsForLink.all(linkId) as Array<{ blobId: string }>) {
      protectedIds.add(row.blobId);
    }
  }
  return protectedIds;
}

/**
 * Drop a victim's bytes from the mount-index DB, mirroring `deleteMountBlob`:
 * the storageKey was the user-visible handle for "the file", so every link to
 * that file goes with it.
 */
function deleteVictimBlob(mountDb: DatabaseType, blobId: string): boolean {
  const blob = mountDb
    .prepare('SELECT fileId FROM doc_mount_blobs WHERE id = ?')
    .get(blobId) as { fileId: string } | undefined;
  if (!blob) return false;

  const links = mountDb
    .prepare('SELECT id FROM doc_mount_file_links WHERE fileId = ?')
    .all(blob.fileId) as Array<{ id: string }>;

  const deleteChunks = mountDb.prepare('DELETE FROM doc_mount_chunks WHERE linkId = ?');
  for (const link of links) {
    deleteChunks.run(link.id);
  }

  mountDb.prepare('DELETE FROM doc_mount_file_links WHERE fileId = ?').run(blob.fileId);
  mountDb.prepare('DELETE FROM doc_mount_documents WHERE fileId = ?').run(blob.fileId);
  mountDb.prepare('DELETE FROM doc_mount_blobs WHERE fileId = ?').run(blob.fileId);
  mountDb.prepare('DELETE FROM doc_mount_files WHERE id = ?').run(blob.fileId);
  return true;
}

/**
 * Rewrite every `victim → survivor` occurrence in a JSON column.
 *
 * Reports progress per row rather than per *changed* row: this walks every
 * chat and every character whatever the remap contains, and on a large
 * instance that is a second the loading screen would otherwise spend saying
 * nothing.
 */
function repointJsonColumn(
  db: DatabaseType,
  table: string,
  column: string,
  unit: string,
  remap: Map<string, string>,
  rewrite: (parsed: unknown, remap: Map<string, string>) => { value: unknown; changed: boolean }
): number {
  const rows = db
    .prepare(`SELECT id, ${column} AS payload FROM ${table} WHERE ${column} IS NOT NULL`)
    .all() as Array<{ id: string; payload: string }>;

  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
  let changedCount = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    reportProgress(i + 1, rows.length, unit);
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch {
      continue; // Malformed payloads are left exactly as they are.
    }
    const { value, changed } = rewrite(parsed, remap);
    if (changed) {
      update.run(JSON.stringify(value), row.id);
      changedCount += 1;
    }
  }

  return changedCount;
}

export const collapseDuplicateAvatarRollsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Collapse duplicate avatar rolls to one image per configuration',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-file-generation-key-column-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('files')) return false;
    if (!sqliteColumnExists('files', 'generationKey')) return false;

    const db = getSQLiteDatabase();
    const pending = db
      .prepare(
        `SELECT 1 FROM files
          WHERE ${AVATAR_FILENAME_PREDICATE}
            AND category = 'IMAGE'
            AND generationPrompt IS NOT NULL
            AND generationPrompt != ''
            AND generationKey IS NULL
          LIMIT 1`
      )
      .get();

    return pending !== undefined;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const db = getSQLiteDatabase();
    let mountDb: DatabaseType | null = null;

    try {
      // Opened before grouping: which rolls are off-limits decides who can be a
      // victim, not merely what gets deleted.
      mountDb = openMountIndexDbIfPresent();
      const protectedIds = protectedBlobIds(db, mountDb);

      const rows = selectAvatarRows(db);

      // Group by the v0 key: the most faithful reconstruction available for a
      // row generated before the cache existed.
      const groups = new Map<string, AvatarRow[]>();
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        reportProgress(i + 1, rows.length, 'portraits examined');
        const key = deriveLegacyAvatarCacheKey({
          modelName: row.generationModel,
          prompt: row.generationPrompt ?? '',
        });
        const bucket = groups.get(key);
        if (bucket) bucket.push(row);
        else groups.set(key, [row]);
      }

      // Survivor per group, and the victim → survivor remap driving every
      // repoint below.
      const remap = new Map<string, string>();
      const survivors: Array<{ id: string; key: string }> = [];
      const victims: AvatarRow[] = [];

      for (const [key, bucket] of groups) {
        const ordered = [...bucket].sort((a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt))
        );
        const [survivor, ...rest] = ordered;
        survivors.push({ id: survivor.id, key });
        for (const victim of rest) {
          const blobId = blobIdFromStorageKey(victim.storageKey);
          if (blobId && protectedIds.has(blobId)) {
            // Still serving as a character's portrait. It keeps its row and its
            // bytes, and is keyed alongside the survivor — it is a perfectly
            // truthful image of this configuration, and the lookup prefers the
            // newest holder of a key anyway.
            survivors.push({ id: victim.id, key });
            logger.info('Keeping avatar roll still serving as a character portrait', {
              context: 'migration.collapse-duplicate-avatar-rolls',
              fileId: victim.id,
            });
            continue;
          }
          remap.set(victim.id, survivor.id);
          victims.push(victim);
        }
      }

      logger.info('Collapsing avatar rolls', {
        context: 'migration.collapse-duplicate-avatar-rolls',
        avatarRows: rows.length,
        configurations: groups.size,
        victims: victims.length,
      });

      // ---- 1. Key the survivors -------------------------------------------
      const setKey = db.prepare('UPDATE files SET generationKey = ? WHERE id = ?');
      for (let i = 0; i < survivors.length; i += 1) {
        setKey.run(survivors[i].key, survivors[i].id);
        reportProgress(i + 1, survivors.length, 'portraits');
      }

      if (victims.length === 0) {
        const durationMs = Date.now() - startTime;
        return {
          id: MIGRATION_ID,
          success: true,
          itemsAffected: rows.length,
          message: `Keyed ${survivors.length} avatar configurations; nothing to collapse`,
          durationMs,
          timestamp: new Date().toISOString(),
        };
      }

      // ---- 2. Repoint every reference to a victim --------------------------
      // chats.characterAvatars: { [characterId]: { imageId, ... } }
      const chatsChanged = repointJsonColumn(db, 'chats', 'characterAvatars', 'chats', remap, (parsed, map) => {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { value: parsed, changed: false };
        }
        let changed = false;
        const next: Record<string, unknown> = {};
        for (const [characterId, entry] of Object.entries(parsed as Record<string, unknown>)) {
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            const record = entry as Record<string, unknown>;
            const imageId = typeof record.imageId === 'string' ? record.imageId : null;
            const survivor = imageId ? map.get(imageId) : undefined;
            if (survivor) {
              next[characterId] = { ...record, imageId: survivor };
              changed = true;
              continue;
            }
          }
          next[characterId] = entry;
        }
        return { value: next, changed };
      });

      // characters.avatarOverrides: [{ chatId, imageId }]
      const charactersChanged = repointJsonColumn(
        db,
        'characters',
        'avatarOverrides',
        'characters',
        remap,
        (parsed, map) => {
          if (!Array.isArray(parsed)) return { value: parsed, changed: false };
          let changed = false;
          const next = parsed.map((entry) => {
            if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
              const record = entry as Record<string, unknown>;
              const imageId = typeof record.imageId === 'string' ? record.imageId : null;
              const survivor = imageId ? map.get(imageId) : undefined;
              if (survivor) {
                changed = true;
                return { ...record, imageId: survivor };
              }
            }
            return entry;
          });
          return { value: next, changed };
        }
      );

      // chat_messages.attachments: [fileId, ...] — plus the uuid the Lantern
      // quoted inline, which must name the file actually attached.
      const messageRows = db
        .prepare(
          `SELECT id, attachments, content, opaqueContent
             FROM chat_messages
            WHERE attachments IS NOT NULL AND attachments != '[]'`
        )
        .all() as Array<{
          id: string;
          attachments: string;
          content: string | null;
          opaqueContent: string | null;
        }>;

      const updateMessage = db.prepare(
        'UPDATE chat_messages SET attachments = ?, content = ?, opaqueContent = ? WHERE id = ?'
      );
      let messagesChanged = 0;

      for (let i = 0; i < messageRows.length; i += 1) {
        const row = messageRows[i];
        let attachments: unknown;
        try {
          attachments = JSON.parse(row.attachments);
        } catch {
          continue;
        }
        if (!Array.isArray(attachments)) continue;

        const swapped: string[] = [];
        // Only the ids this message actually carried — substituting the whole
        // remap into every message would scan the full victim list per row.
        const swappedHere: Array<[string, string]> = [];
        for (const entry of attachments) {
          const survivor = typeof entry === 'string' ? remap.get(entry) : undefined;
          if (survivor) {
            swapped.push(survivor);
            swappedHere.push([entry as string, survivor]);
          } else {
            swapped.push(entry as string);
          }
        }

        if (swappedHere.length > 0) {
          let content = row.content;
          let opaqueContent = row.opaqueContent;
          for (const [victimId, survivorId] of swappedHere) {
            if (content?.includes(victimId)) {
              content = content.split(victimId).join(survivorId);
            }
            if (opaqueContent?.includes(victimId)) {
              opaqueContent = opaqueContent.split(victimId).join(survivorId);
            }
          }
          updateMessage.run(JSON.stringify(swapped), content, opaqueContent, row.id);
          messagesChanged += 1;
        }

        reportProgress(i + 1, messageRows.length, 'messages');
      }

      // ---- 3. Delete the victims -------------------------------------------
      const deleteFileRow = db.prepare('DELETE FROM files WHERE id = ?');
      let blobsDeleted = 0;

      for (let i = 0; i < victims.length; i += 1) {
        const victim = victims[i];
        const blobId = blobIdFromStorageKey(victim.storageKey);

        if (mountDb && blobId) {
          try {
            if (deleteVictimBlob(mountDb, blobId)) {
              blobsDeleted += 1;
            }
          } catch (error) {
            // A blob that refuses to go is not a reason to abandon the pass;
            // the files row stays too, and the next run retries the pair.
            logger.warn('Failed to delete avatar blob, leaving its file row in place', {
              context: 'migration.collapse-duplicate-avatar-rolls',
              fileId: victim.id,
              blobId,
              error: error instanceof Error ? error.message : String(error),
            });
            reportProgress(i + 1, victims.length, 'duplicate portraits');
            continue;
          }
        }

        deleteFileRow.run(victim.id);
        reportProgress(i + 1, victims.length, 'duplicate portraits');
      }

      const durationMs = Date.now() - startTime;

      logger.info('Collapsed duplicate avatar rolls', {
        context: 'migration.collapse-duplicate-avatar-rolls',
        configurations: groups.size,
        rowsKeyed: survivors.length,
        victimsDeleted: victims.length,
        blobsDeleted,
        chatsChanged,
        charactersChanged,
        messagesChanged,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        // Every avatar row this pass touched: keyed, deleted, or both.
        itemsAffected: rows.length,
        message:
          `Collapsed ${rows.length} avatar rolls to ${groups.size} configurations ` +
          `(${blobsDeleted} images freed; repointed ${chatsChanged} chats, ` +
          `${charactersChanged} characters, ${messagesChanged} messages)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to collapse duplicate avatar rolls', {
        context: 'migration.collapse-duplicate-avatar-rolls',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to collapse duplicate avatar rolls',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } finally {
      mountDb?.close();
    }
  },
};
