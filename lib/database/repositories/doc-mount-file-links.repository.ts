/**
 * Document Mount File Links Repository
 *
 * Manages doc_mount_file_links — the join between doc_mount_files (content)
 * and doc_mount_points (location). One row per visible file at a given
 * (mountPointId, relativePath). Multiple link rows may reference the same
 * file row (hard linking).
 *
 * Most consumer queries want a joined view that bundles link-level state
 * with content fields (sha256, fileSizeBytes, fileType, source); the
 * find* methods here return DocMountFileLinkWithContent for that reason.
 *
 * Cleanup: deleteWithGC removes a link, cascades to its chunks (FK), and
 * deletes the underlying file row if no other link references it. Content
 * byte-stores (doc_mount_documents / doc_mount_blobs) cascade off
 * doc_mount_files.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import * as posixPath from 'path/posix';
import { logger } from '@/lib/logger';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import {
  DocMountFile,
  DocMountFileLink,
  DocMountFileLinkSchema,
  DocMountFileLinkWithContent,
  EDITABLE_TEXT_FILE_TYPES,
} from '@/lib/schemas/mount-index.types';
import { CreateOptions } from './base.repository';
import { AbstractDedicatedDbRepository } from './dedicated-db.repository';
import { requireMountIndexDb } from '../backends/sqlite/mount-index-guard';
import { normalizeLinkBlobImage } from '@/lib/mount-index/normalize-blob-image';
import { invalidateMountPoint } from '@/lib/mount-index/mount-chunk-cache';
import { ensureLinkNocaseUniqueIndex, ensureLinkGroupColumn } from './mount-index-case-repair';
import { policyFromContent, DEFAULT_DOCUMENT_POLICY } from '@/lib/doc-edit/document-policy';
import { LIKE_ESCAPE_CHAR, likeContainsPattern } from './like-escape';
import {
  gcOrphanedFileRow,
  reapOrphanedStoreChildren,
  type OrphanedStoreChildrenSwept,
} from '@/lib/mount-index/orphan-store-reaper';

// Minimal subset of better-sqlite3's Database that the inline folder helper
// uses. Avoids dragging the type into every link* method signature.
type SyncDb = {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
};

/** Identity of a link, enough to re-index it. */
export interface GroupSibling {
  id: string;
  mountPointId: string;
  relativePath: string;
}

/**
 * Fan a content repoint out to the rest of a deliberate hard-link group.
 *
 * This is what makes `docs link` behave like a POSIX hard link: a write
 * through any member moves EVERY member onto the new content row, so no
 * member can silently drift to stale bytes. Callers pass the group id read
 * off the link they just wrote; a null group is a no-op (an ordinary,
 * independent link — including one that merely shares a content-addressed
 * fileId with an unrelated file of identical bytes).
 *
 * Per-link metadata is deliberately NOT propagated. Two consumers of the same
 * bytes may keep their own `description` and their own extracted text /
 * caption — that independence is a documented property of the link model, and
 * only the bytes are shared. Chunks are keyed by linkId and are re-built by
 * the caller (see reindexGroupSiblings), not here.
 *
 * Runs synchronously inside the caller's `db.transaction(...)`.
 *
 * @returns the siblings that were repointed (excluding `excludeLinkId`)
 */
/**
 * Delete every chunk row belonging to `linkIds`.
 *
 * Tolerates a mount index whose `doc_mount_chunks` table has not been created
 * yet: this repository's tables are minted lazily on first use, so a store
 * written to before anything has ever chunked has no such table, and a
 * missing table means there are no stale chunks to retire anyway. Anything
 * else is a real failure and rolls the enclosing write back.
 */
function dropChunksForLinks(db: SyncDb, linkIds: string[]): void {
  if (linkIds.length === 0) return;
  const placeholders = linkIds.map(() => '?').join(', ');
  try {
    db.prepare(`DELETE FROM doc_mount_chunks WHERE linkId IN (${placeholders})`).run(...linkIds);
  } catch (err) {
    if (!/no such table/i.test(err instanceof Error ? err.message : String(err))) throw err;
  }
}

function fanOutGroupFileId(
  db: SyncDb,
  groupId: string | null,
  excludeLinkId: string,
  newFileId: string,
  /** Per-location mtime to stamp on the siblings (the writer's, not the clock's). */
  lastModified: string,
  now: string,
  /** Text-shaped columns to carry along; omit for blobs. */
  textState: { plainTextLength: number; allowEmbed: number; allowCharacterRead: number; allowCharacterWrite: number } | null
): GroupSibling[] {
  if (!groupId) return [];

  const siblings = db.prepare(
    `SELECT id, mountPointId, relativePath, fileId FROM doc_mount_file_links
     WHERE linkGroupId = ? AND id <> ?`
  ).all(groupId, excludeLinkId) as (GroupSibling & { fileId: string })[];
  if (siblings.length === 0) return [];

  if (textState) {
    // Bug 156, the sibling half: each member keeps its own chunks, so a
    // repointed sibling's chunks are as stale as the writer's own. Drop them
    // and zero the count for exactly the members whose content moved, so
    // `reindexLinkGroupSiblings` (parent) or the next rescan (child) rebuilds
    // them rather than leaving the previous revision answering searches.
    const moved = siblings.filter(sib => sib.fileId !== newFileId).map(sib => sib.id);
    if (moved.length > 0) {
      dropChunksForLinks(db, moved);
      db.prepare(
        `UPDATE doc_mount_file_links SET chunkCount = 0 WHERE id IN (${moved.map(() => '?').join(', ')})`
      ).run(...moved);
    }
    db.prepare(
      `UPDATE doc_mount_file_links SET
         fileId = ?, plainTextLength = ?,
         conversionStatus = 'converted', conversionError = NULL,
         allowEmbed = ?, allowCharacterRead = ?, allowCharacterWrite = ?,
         lastModified = ?, updatedAt = ?
       WHERE linkGroupId = ? AND id <> ?`
    ).run(
      newFileId, textState.plainTextLength,
      textState.allowEmbed, textState.allowCharacterRead, textState.allowCharacterWrite,
      lastModified, now, groupId, excludeLinkId
    );
  } else {
    db.prepare(
      `UPDATE doc_mount_file_links SET fileId = ?, lastModified = ?, updatedAt = ?
       WHERE linkGroupId = ? AND id <> ?`
    ).run(newFileId, lastModified, now, groupId, excludeLinkId);
  }

  return siblings.map(({ id, mountPointId, relativePath }) => ({ id, mountPointId, relativePath }));
}

/**
 * Walk every segment of `folderPath` (relative, POSIX-style) and find-or-create
 * a `doc_mount_folders` row for each, returning the leaf folder's id (or null
 * when `folderPath` is empty / `.` / `/`).
 *
 * Runs inline against the raw mount-index DB handle so it can be invoked
 * inside the `db.transaction(...)` blocks below without crossing an async
 * boundary — folder creation participates in the same transaction as the
 * link write, so a failed link insert rolls the folder rows back too.
 *
 * Mirrors the segment-by-segment idempotent walk in
 * `lib/mount-index/folder-paths.ts#ensureFolderPath`, plus an
 * `ON CONFLICT`-style fallback for races.
 *
 * Folder matching is case-insensitive and case-preserving: a segment that
 * matches an existing folder except for casing reuses that folder, and the
 * walk continues under the folder's STORED casing. `canonicalDir` is the
 * resulting stored-casing directory path ('' for root) so callers can keep
 * the link's relativePath consistent with the folder rows.
 */
function ensureLinkFolderId(
  db: SyncDb,
  mountPointId: string,
  relativePath: string,
  now: string,
): { folderId: string | null; canonicalDir: string } {
  const dir = posixPath.dirname(relativePath || '');
  if (!dir || dir === '.' || dir === '/') return { folderId: null, canonicalDir: '' };

  const normalized = dir.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return { folderId: null, canonicalDir: '' };

  const segments = normalized.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return { folderId: null, canonicalDir: '' };

  // Exact match wins; the NOCASE fallback rides the case-insensitive unique
  // index on (mountPointId, parentId, name)-equivalent paths.
  const findStmt = db.prepare(
    `SELECT id, path FROM doc_mount_folders WHERE mountPointId = ? AND path = ? COLLATE NOCASE
     ORDER BY (path = ?) DESC LIMIT 1`
  );
  const insertStmt = db.prepare(
    `INSERT INTO doc_mount_folders (id, mountPointId, parentId, name, path, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  let currentParentId: string | null = null;
  let currentPath = '';

  for (const segment of segments) {
    const requestedPath = currentPath ? `${currentPath}/${segment}` : segment;
    let row = findStmt.get(mountPointId, requestedPath, requestedPath) as
      | { id: string; path: string }
      | undefined;
    if (!row) {
      const id = randomUUID();
      try {
        insertStmt.run(id, mountPointId, currentParentId, segment, requestedPath, now, now);
        currentParentId = id;
        currentPath = requestedPath;
        continue;
      } catch (err) {
        // Re-look up after conflict (UNIQUE(mountPointId, parentId, name NOCASE)).
        row = findStmt.get(mountPointId, requestedPath, requestedPath) as
          | { id: string; path: string }
          | undefined;
        if (!row) throw err;
      }
    }
    currentParentId = row.id;
    currentPath = row.path;
  }

  return { folderId: currentParentId, canonicalDir: currentPath };
}

export type FileType = DocMountFile['fileType'];
export type FileSource = DocMountFile['source'];

/**
 * Coerce a SQLite `allow*` policy column (stored 0/1, occasionally absent on a
 * pre-migration row) into a boolean. Absent/unknown → permissive (true), which
 * matches both the SQL default and the frontmatter default.
 */
function coerceAllow(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  return value !== 0;
}

/** The three per-document policy flags, in their positive-sense column form. */
export interface LinkPolicyFlags {
  allowEmbed: boolean;
  allowCharacterRead: boolean;
  allowCharacterWrite: boolean;
}

interface LinkBlobInput {
  mountPointId: string;
  relativePath: string;
  fileName: string;
  folderId: string | null;
  /**
   * File-row fileType. Defaults to `'blob'` (no chunkable text). PDFs and
   * DOCX files store bytes in doc_mount_blobs as well, but declare their
   * fileType so the conversion pipeline picks them up for text extraction.
   */
  fileType?: FileType;
  originalFileName: string;
  originalMimeType: string;
  storedMimeType: string;
  /**
   * Advisory only. The content-addressed store is authoritative about its
   * own hashes: linkBlobContent recomputes sha256 from `data` and uses the
   * computed value for dedup and both inserts, warning on any mismatch.
   */
  sha256: string;
  /** Bytes destined for doc_mount_blobs. */
  data: Buffer;
  /**
   * Normalize image bytes to WebP before storing (default `true`).
   *
   * This is the chokepoint: transcoding at the call sites was optional and
   * eight of them skipped it, which is how untranscoded PNGs and oversized
   * lossless WebP reached the store. Normalizing here means no write path can
   * bypass it. `storedMimeType`, `relativePath` and `fileName` are rewritten
   * to match whatever is actually stored.
   *
   * Set `false` ONLY for byte-fidelity restores — importing a `.qtap` bundle
   * or rehydrating an archive, where the bytes must come back exactly as they
   * went in. Never set it false to "save time" on an upload.
   */
  normalizeImages?: boolean;
  /**
   * Omitted means "no opinion", NOT "blank it" (bug 155). On a fresh insert an
   * omitted `description` / `extractedText` / `extractionStatus` takes the
   * empty default; on an upsert over an existing link the stored value is
   * kept. An explicit `''` still clears the description — that is a `set`.
   */
  description?: string;
  conversionStatus?: DocMountFileLink['conversionStatus'];
  /** Set when the caller has already extracted text (e.g. PDF). */
  extractedText?: string | null;
  extractedTextSha256?: string | null;
  extractionStatus?: DocMountFileLink['extractionStatus'];
  /**
   * Per-location timestamps. Callers that are restoring or mirroring a file
   * whose times are known — the document-store sync — supply them so the two
   * sides converge; every other caller omits them and gets `now`.
   * `createdAt` is honoured on INSERT only.
   */
  lastModified?: string;
  createdAt?: string;
  /**
   * Explicit row ids for `preserveIds` imports (archive/rehydrate, spec F4).
   * Honored only when the row in question is actually being *created*; an
   * existing row found by sha256 or (mountPointId, relativePath) keeps its
   * own id — the content-addressed dedup and path-upsert invariants win.
   */
  fileId?: string;
  blobId?: string;
  linkId?: string;
}

interface LinkDocumentInput {
  mountPointId: string;
  relativePath: string;
  fileName: string;
  folderId: string | null;
  fileType: Extract<FileType, 'markdown' | 'txt' | 'json' | 'jsonl'>;
  content: string;
  contentSha256: string;
  plainTextLength: number;
  fileSizeBytes: number;
  /** Per-document policy parsed from markdown frontmatter. Defaults permissive. */
  allowEmbed?: boolean;
  allowCharacterRead?: boolean;
  allowCharacterWrite?: boolean;
  /**
   * Per-location timestamps. See {@link LinkBlobInput.lastModified}.
   * `createdAt` is honoured on INSERT only.
   */
  lastModified?: string;
  createdAt?: string;
  /**
   * Explicit row ids for `preserveIds` imports (archive/rehydrate, spec F4).
   * Honored only when the row in question is actually being *created*; an
   * existing row found by sha256 or (mountPointId, relativePath) keeps its
   * own id — the content-addressed dedup and path-upsert invariants win.
   */
  fileId?: string;
  documentId?: string;
  linkId?: string;
}

interface LinkFilesystemFileInput {
  mountPointId: string;
  relativePath: string;
  fileName: string;
  folderId?: string | null;
  fileType: FileType;
  sha256: string;
  fileSizeBytes: number;
  lastModified: string;
  /** Defaults to 'filesystem' — set 'database' for files whose bytes live in doc_mount_documents/blobs. */
  source?: FileSource;
  conversionStatus?: DocMountFileLink['conversionStatus'];
  conversionError?: string | null;
  plainTextLength?: number | null;
  chunkCount?: number;
  /** Per-document policy parsed from markdown frontmatter. Defaults permissive. */
  allowEmbed?: boolean;
  allowCharacterRead?: boolean;
  allowCharacterWrite?: boolean;
}

// Raw SQLite row shape for the joined SELECT (link.* + file content fields).
// Strings/numbers — booleans aren't part of this row, so no coercion needed
// beyond the JSON-decoded columns the SQLiteCollection helper handles for us.
type JoinedRow = DocMountFileLink & Pick<DocMountFile, 'sha256' | 'fileSizeBytes' | 'fileType' | 'source'>;

/**
 * A link row matched by {@link DocMountFileLinksRepository.searchByNameOrPath}.
 * Deliberately narrow — the global search only needs identity, location and a
 * sort key, not the joined content columns.
 */
export interface DocMountLinkTextMatch {
  id: string;
  mountPointId: string;
  relativePath: string;
  fileName: string;
  updatedAt: string;
}

export class DocMountFileLinksRepository extends AbstractDedicatedDbRepository<DocMountFileLink> {
  constructor() {
    super('doc_mount_file_links', DocMountFileLinkSchema, { dbTarget: 'mountIndex', acquireDb: requireMountIndexDb });
  }

  /**
   * Extra DDL, run once after the generated statements on first access.
   */
  protected override onTableEnsured(db: DatabaseType): void {
    // Align linkGroupId before anything reads the table — a missing column
    // presents as every document silently not existing. See the helper.
    ensureLinkGroupColumn(db);

    // Case-insensitive (mountPointId, relativePath) uniqueness: one file
    // per location, where `Notes.md` and `notes.md` are the same location
    // (all path lookups already compare via LOWER()). Runs a repair scan
    // every init (catching out-of-band edits, and swapping out the legacy
    // case-sensitive index on older databases) before guaranteeing the
    // NOCASE index.
    ensureLinkNocaseUniqueIndex(db);
    db.exec(
      `CREATE INDEX IF NOT EXISTS "idx_${this.collectionName}_fileId" ` +
      `ON "${this.collectionName}" ("fileId")`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS "idx_${this.collectionName}_mountPointId" ` +
      `ON "${this.collectionName}" ("mountPointId")`
    );
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<DocMountFileLink, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountFileLink> {
    // Enforce: a filesystem-source file may have at most one link, because
    // its bytes live at a single basePath/relativePath. Database-source
    // files can be hard-linked freely.
    await this.withRawDb(
      undefined,
      (db) => {
        const existing = db.prepare(
          `SELECT f.source AS source, COUNT(l.id) AS linkCount
           FROM doc_mount_files f
           LEFT JOIN doc_mount_file_links l ON l.fileId = f.id
           WHERE f.id = ?
           GROUP BY f.id`
        ).get(data.fileId) as { source: string; linkCount: number } | undefined;
        if (existing && existing.source === 'filesystem' && existing.linkCount > 0) {
          throw new Error(
            `Cannot create a second link for filesystem-source file ${data.fileId}: ` +
            `filesystem files are constrained to one link per file.`
          );
        }
      },
      'Error checking the one-link constraint for a filesystem-source file',
      { fileId: data.fileId },
      'rethrow',
    );
    return this._create(data, options);
  }

  async update(id: string, data: Partial<DocMountFileLink>): Promise<DocMountFileLink | null> {
    return this._update(id, data);
  }

  /**
   * Plain delete with no GC. Callers should generally use deleteWithGC.
   */
  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  /**
   * Overwrite the three per-document policy columns for a link. Source of
   * truth is the document's markdown frontmatter, re-derived at index time;
   * callers (reindex / scanner) pass the freshly-parsed {@link LinkPolicyFlags}.
   * Stored as 0/1; the rest of the code sees booleans (see {@link coerceAllow}).
   */
  async updatePolicyFlags(linkId: string, policy: LinkPolicyFlags): Promise<void> {
    await this.withRawDb(
      undefined,
      async (db) => {
        db.prepare(
          `UPDATE doc_mount_file_links
             SET allowEmbed = ?, allowCharacterRead = ?, allowCharacterWrite = ?, updatedAt = ?
           WHERE id = ?`
        ).run(
          policy.allowEmbed ? 1 : 0,
          policy.allowCharacterRead ? 1 : 0,
          policy.allowCharacterWrite ? 1 : 0,
          new Date().toISOString(),
          linkId
        );
      },
      'Error updating document policy flags',
      { linkId },
      'rethrow'
    );
  }

  // ============================================================================
  // Joined-view query helpers — these are what most consumers call
  // ============================================================================

  /**
   * Fetch all link rows for a mount point with content fields joined in.
   */
  async findByMountPointId(mountPointId: string): Promise<DocMountFileLinkWithContent[]> {
    return this.safeQuery(
      async () => this.queryJoined('WHERE l.mountPointId = ?', [mountPointId]),
      'Error finding file links by mount point ID',
      { mountPointId },
      []
    );
  }

  /**
   * Fetch a single link row for a (mountPointId, relativePath) with content
   * fields joined in. relativePath comparison is case-insensitive to match
   * legacy behavior on the old doc_mount_files lookup.
   */
  async findByMountPointAndPath(
    mountPointId: string,
    relativePath: string
  ): Promise<DocMountFileLinkWithContent | null> {
    return this.safeQuery(
      async () => {
        const rows = await this.queryJoined(
          'WHERE l.mountPointId = ? AND LOWER(l.relativePath) = LOWER(?)',
          [mountPointId, relativePath]
        );
        return rows[0] ?? null;
      },
      'Error finding file link by mount point and path',
      { mountPointId, relativePath },
      null
    );
  }

  /**
   * Find every link that references a single file (the inverse of the FK).
   * Useful for ref-counting and for displaying "this file appears in N
   * places" to the user.
   */
  async findByFileId(fileId: string): Promise<DocMountFileLinkWithContent[]> {
    return this.safeQuery(
      async () => this.queryJoined('WHERE l.fileId = ?', [fileId]),
      'Error finding file links by file ID',
      { fileId },
      []
    );
  }

  /**
   * Find one link by its primary key, joined with content fields.
   */
  async findByIdWithContent(id: string): Promise<DocMountFileLinkWithContent | null> {
    return this.safeQuery(
      async () => {
        const rows = await this.queryJoined('WHERE l.id = ?', [id]);
        return rows[0] ?? null;
      },
      'Error finding file link by id',
      { id },
      null
    );
  }

  /**
   * Batched variant of {@link findByIdWithContent}. Returns one query result
   * per unique id — duplicates and missing ids are squashed. Used by the
   * chat-list enrichment hot path so we don't fan out per-character avatar
   * lookups across hundreds of chats.
   */
  async findByIdsWithContent(ids: string[]): Promise<DocMountFileLinkWithContent[]> {
    if (ids.length === 0) return [];
    const unique = Array.from(new Set(ids));
    return this.safeQuery(
      async () => {
        const placeholders = unique.map(() => '?').join(',');
        return this.queryJoined(`WHERE l.id IN (${placeholders})`, unique);
      },
      'Error finding file links by ids',
      { count: unique.length },
      []
    );
  }

  /**
   * Substring-search link rows by file name or relative path across a set of
   * mount points. Powers the global search bar's Documents chip
   * ({@link ../../mount-index/document-text-search}); the companion
   * content search lives on the chunks repository.
   *
   * Scoped to {@link EDITABLE_TEXT_FILE_TYPES} — the search surface only
   * offers documents Document Mode can actually open, so PDFs, DOCX and
   * blobs are out. Matching is case-insensitive via `LOWER()` (SQLite's bare
   * `LIKE` only folds ASCII), and `%`/`_` in the user's query are escaped so
   * they match literally.
   */
  async searchByNameOrPath(
    query: string,
    mountPointIds: string[],
    limit: number
  ): Promise<DocMountLinkTextMatch[]> {
    if (mountPointIds.length === 0 || query.length === 0) return [];
    return this.withRawDb(
      [],
      async (db) => {
        const placeholders = mountPointIds.map(() => '?').join(',');
        const typePlaceholders = EDITABLE_TEXT_FILE_TYPES.map(() => '?').join(',');
        const pattern = likeContainsPattern(query);

        const rows = db.prepare(
          `SELECT l.id, l.mountPointId, l.relativePath, l.fileName, l.updatedAt
             FROM doc_mount_file_links l
             JOIN doc_mount_files f ON f.id = l.fileId
            WHERE l.mountPointId IN (${placeholders})
              AND f.fileType IN (${typePlaceholders})
              AND (LOWER(l.fileName) LIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}'
                OR LOWER(l.relativePath) LIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}')
            ORDER BY l.updatedAt DESC
            LIMIT ?`
        ).all(
          ...mountPointIds,
          ...EDITABLE_TEXT_FILE_TYPES,
          pattern,
          pattern,
          limit
        ) as DocMountLinkTextMatch[];

        return rows;
      },
      'Error searching file links by name or path',
      { mountPointIdCount: mountPointIds.length, queryLength: query.length }
    );
  }

  // ============================================================================
  // Deliberate hard-link groups
  // ============================================================================

  /**
   * Enrol two links in the same hard-link group, so a write through either one
   * repoints both (see {@link fanOutGroupFileId}). Reuses the source's existing
   * group when it already has one, so linking a third location to an
   * already-linked file extends the group rather than splitting it.
   *
   * Only `docs link` calls this. `docs copy` deliberately does not: a copy that
   * happens to share a content row through sha dedup must still fork on the
   * next write, which is exactly what a null group gives you.
   *
   * @returns the group id both links now carry, or null if either link is gone
   */
  async bindLinkGroup(sourceLinkId: string, destLinkId: string): Promise<string | null> {
    return this.withRawDb(
      null,
      async (db) => {
        const now = new Date().toISOString();
        const tx = db.transaction(() => {
          const source = db.prepare(
            'SELECT id, linkGroupId FROM doc_mount_file_links WHERE id = ?'
          ).get(sourceLinkId) as { id: string; linkGroupId: string | null } | undefined;
          const dest = db.prepare(
            'SELECT id FROM doc_mount_file_links WHERE id = ?'
          ).get(destLinkId) as { id: string } | undefined;
          if (!source || !dest) return null;

          const groupId = source.linkGroupId ?? randomUUID();
          const stmt = db.prepare(
            'UPDATE doc_mount_file_links SET linkGroupId = ?, updatedAt = ? WHERE id = ?'
          );
          if (!source.linkGroupId) stmt.run(groupId, now, sourceLinkId);
          stmt.run(groupId, now, destLinkId);
          return groupId;
        });

        const groupId = tx();
        if (groupId) {
          logger.debug('Bound links into hard-link group', { sourceLinkId, destLinkId, groupId });
        }
        return groupId;
      },
      'Error binding hard-link group',
      { sourceLinkId, destLinkId }
    );
  }

  /**
   * Every link in a hard-link group, joined with content fields. Used to
   * re-chunk the siblings a write just repointed.
   */
  async findByLinkGroupId(linkGroupId: string): Promise<DocMountFileLinkWithContent[]> {
    return this.safeQuery(
      async () => this.queryJoined('WHERE l.linkGroupId = ?', [linkGroupId]),
      'Error finding file links by link group ID',
      { linkGroupId },
      []
    );
  }

  // ============================================================================
  // Timestamps
  // ============================================================================

  /**
   * Set a link's per-location timestamps without touching its content.
   *
   * The mirror half of `lastModified` / `createdAt` on the two `link*Content`
   * writers: a document-store sync that finds both sides byte-identical but
   * differently dated copies the winner's clock across rather than the bytes.
   * `updatedAt` is the row's own audit column and always moves to now — it is
   * not the file's mtime.
   *
   * Returns false when no such link exists (or nothing was asked for).
   */
  async setLinkTimestamps(
    linkId: string,
    times: { lastModified?: string; createdAt?: string }
  ): Promise<boolean> {
    return this.withRawDb(
      false,
      async (db) => {
        const sets: string[] = [];
        const values: unknown[] = [];
        if (times.lastModified !== undefined) {
          sets.push('lastModified = ?');
          values.push(times.lastModified);
        }
        if (times.createdAt !== undefined) {
          sets.push('createdAt = ?');
          values.push(times.createdAt);
        }
        if (sets.length === 0) return false;

        sets.push('updatedAt = ?');
        values.push(new Date().toISOString(), linkId);

        const result = db.prepare(
          `UPDATE doc_mount_file_links SET ${sets.join(', ')} WHERE id = ?`
        ).run(...values as never[]);
        return result.changes > 0;
      },
      'Error setting file link timestamps',
      { linkId }
    );
  }

  // ============================================================================
  // Deletion with garbage-collection of the underlying file
  // ============================================================================

  /**
   * Delete a link. Cascades to chunks (FK ON DELETE CASCADE). If the link
   * was the last reference to its file, also deletes the file row, which
   * cascades to doc_mount_documents and doc_mount_blobs via FK.
   *
   * Returns the fileId of the deleted link (so callers can react), and a
   * boolean indicating whether the underlying file was garbage-collected.
   */
  async deleteWithGC(linkId: string): Promise<{ fileId: string | null; fileGC: boolean }> {
    return this.withRawDb(
      { fileId: null, fileGC: false },
      async (db) => {
        const link = db.prepare(
          'SELECT fileId, mountPointId, linkGroupId FROM doc_mount_file_links WHERE id = ?'
        ).get(linkId) as
          { fileId: string; mountPointId: string; linkGroupId: string | null } | undefined;

        if (!link) {
          return { fileId: null, fileGC: false };
        }

        const tx = db.transaction(() => {
          // Chunks cascade via FK ON DELETE CASCADE, but invalidate the
          // mount-chunk cache for this mount before the row vanishes.
          db.prepare('DELETE FROM doc_mount_file_links WHERE id = ?').run(linkId);

          // A group of one is not a hard link any more — unlinking the last
          // sibling must leave an ordinary independent file behind, or the
          // survivor would keep a dangling group id that a future link could
          // accidentally join.
          if (link.linkGroupId) {
            const survivors = db.prepare(
              'SELECT id FROM doc_mount_file_links WHERE linkGroupId = ?'
            ).all(link.linkGroupId) as { id: string }[];
            if (survivors.length <= 1) {
              db.prepare(
                'UPDATE doc_mount_file_links SET linkGroupId = NULL, updatedAt = ? WHERE linkGroupId = ?'
              ).run(new Date().toISOString(), link.linkGroupId);
            }
          }

          // Last link gone — drop the file row and its payload. Shared with
          // the write path and the store cascade so all collect content the
          // same way.
          return gcOrphanedFileRow(db, link.fileId) !== null;
        });

        const fileGC = tx();
        invalidateMountPoint(link.mountPointId);
        return { fileId: link.fileId, fileGC };
      },
      'Error deleting file link with GC',
      { linkId }
    );
  }

  /**
   * Bulk delete every link for a mount point, running GC against the
   * underlying file rows. Returns count of links deleted and count of
   * files garbage-collected.
   */
  async deleteByMountPointId(mountPointId: string): Promise<{ linksDeleted: number; filesGC: number }> {
    return this.withRawDb(
      { linksDeleted: 0, filesGC: 0 },
      async (db) => {
        // Snapshot the affected fileIds so we can ref-count them after the
        // bulk link delete.
        const affectedFileIds = db.prepare(
          'SELECT DISTINCT fileId FROM doc_mount_file_links WHERE mountPointId = ?'
        ).all(mountPointId) as { fileId: string }[];

        let linksDeleted = 0;
        let filesGC = 0;

        const tx = db.transaction(() => {
          const deleteRes = db.prepare(
            'DELETE FROM doc_mount_file_links WHERE mountPointId = ?'
          ).run(mountPointId);
          linksDeleted = deleteRes.changes;

          if (affectedFileIds.length > 0) {
            // Any file whose link count is now 0 gets dropped. Documents/
            // blobs cascade via FK.
            const placeholders = affectedFileIds.map(() => '?').join(',');
            const orphaned = db.prepare(
              `SELECT f.id FROM doc_mount_files f
               WHERE f.id IN (${placeholders})
                 AND NOT EXISTS (
                   SELECT 1 FROM doc_mount_file_links l WHERE l.fileId = f.id
                 )`
            ).all(...affectedFileIds.map(f => f.fileId)) as { id: string }[];

            for (const f of orphaned) {
              db.prepare('DELETE FROM doc_mount_files WHERE id = ?').run(f.id);
              filesGC += 1;
            }
          }
        });

        tx();
        invalidateMountPoint(mountPointId);
        return { linksDeleted, filesGC };
      },
      'Error deleting file links by mount point ID',
      { mountPointId }
    );
  }

  // ============================================================================
  // High-level writers (file + link + bytes in one transaction)
  // ============================================================================

  /**
   * Write a binary asset into a database-backed mount as a hard-linkable
   * resource. Dedups by sha256: if another link already references the
   * same bytes, the existing file row is reused (and its blob is preserved
   * — no rewrite). Otherwise a new file + blob is minted.
   *
   * The link row carries the per-mount metadata (relativePath, fileName,
   * folderId, description) and per-consumer extraction state. A second
   * caller hard-linking the same bytes into another mount gets a fresh
   * link row pointing at the same fileId.
   */
  async linkBlobContent(rawInput: LinkBlobInput): Promise<{
    link: DocMountFileLinkWithContent;
    file: DocMountFile;
    blobId: string;
    /** Hard-link group members repointed by this write. */
    groupSiblings: GroupSibling[];
  }> {
    const db = await this.ensureRawDb();

    // Normalize image bytes BEFORE the hash is computed, so the stored sha256
    // describes the bytes that actually land in the row.
    const input = await normalizeLinkBlobImage(rawInput);

    const now = new Date().toISOString();
    const sizeBytes = input.data.length;

    // The content-addressed store is authoritative about its own hashes:
    // recompute sha256 from the actual bytes rather than trusting the caller.
    // This keeps the invariant sha256 == sha256(stored bytes) — a wrong value
    // (e.g. an upstream input-bytes hash that pre-dates a transcode) would
    // silently defeat dedup and advertise a hash that won't match the bytes.
    const computed = sha256OfBuffer(input.data);
    logger.debug('linkBlobContent: computed content hash', {
      mountPointId: input.mountPointId,
      relativePath: input.relativePath,
      passedSha: input.sha256,
      computedSha: computed,
      sizeBytes,
    });
    if (input.sha256 !== computed) {
      logger.warn('linkBlobContent: caller sha256 disagrees with stored bytes; using computed', {
        mountPointId: input.mountPointId,
        relativePath: input.relativePath,
        passedSha: input.sha256,
        computedSha: computed,
        sizeBytes,
      });
    }

    // Find-or-create the content row by sha. UUID stability invariant: if
    // a content row already exists for these bytes, reuse its id.
    let fileRow = db.prepare(
      `SELECT id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt
       FROM doc_mount_files WHERE sha256 = ?`
    ).get(computed) as DocMountFile | undefined;

    const fileType: FileType = input.fileType ?? 'blob';
    // Default per-link conversion lifecycle: blob fileType has no chunkable
    // text (skipped), pdf/docx start out pending and the conversion runner
    // picks them up later.
    const conversionStatus =
      input.conversionStatus ?? (fileType === 'blob' ? 'skipped' : 'pending');

    const tx = db.transaction(() => {
      if (!fileRow) {
        const id = input.fileId ?? randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_files (id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 'database', ?, ?)`
        ).run(id, computed, sizeBytes, fileType, now, now);
        fileRow = {
          id,
          sha256: computed,
          fileSizeBytes: sizeBytes,
          fileType,
          source: 'database',
          createdAt: now,
          updatedAt: now,
        };
      }

      // Derive folderId from relativePath as the single source of truth.
      // Any caller-supplied input.folderId is informational and ignored —
      // the relativePath wins, and missing folder rows are created here so
      // doc_mount_folders stays in sync with what the link table claims.
      // canonicalRel carries the stored folder casing so the link's path
      // never disagrees with the folder rows except in the leaf name.
      const { folderId, canonicalDir } = ensureLinkFolderId(db, input.mountPointId, input.relativePath, now);
      const canonicalRel = canonicalDir ? `${canonicalDir}/${input.fileName}` : input.fileName;
      if (input.folderId !== undefined && input.folderId !== folderId) {
        logger.warn('linkBlobContent: caller folderId disagrees with relativePath; using derived', {
          mountPointId: input.mountPointId,
          relativePath: input.relativePath,
          callerFolderId: input.folderId,
          derivedFolderId: folderId,
        });
      }

      // Upsert the blob bytes for this fileId. If the blob already exists
      // (because the content row was reused), we keep the existing bytes
      // — they're identical by sha. Only insert if missing.
      const existingBlob = db.prepare(
        `SELECT id FROM doc_mount_blobs WHERE fileId = ?`
      ).get(fileRow.id) as { id: string } | undefined;
      let blobId: string;
      if (existingBlob) {
        blobId = existingBlob.id;
      } else {
        blobId = input.blobId ?? randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_blobs (id, fileId, sha256, sizeBytes, storedMimeType, data, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(blobId, fileRow.id, computed, sizeBytes, input.storedMimeType, input.data, now, now);
      }

      // Upsert the link row. The UNIQUE(mountPointId, relativePath NOCASE)
      // index means a second write to the same path — in any casing —
      // overwrites the existing link's metadata in place rather than
      // creating a duplicate. Case-preserving: the existing row keeps its
      // relativePath/fileName casing.
      const existingLink = db.prepare(
        `SELECT id, fileId, linkGroupId FROM doc_mount_file_links
         WHERE mountPointId = ? AND relativePath = ? COLLATE NOCASE`
      ).get(input.mountPointId, canonicalRel) as
        { id: string; fileId: string; linkGroupId: string | null } | undefined;

      const description = input.description ?? '';
      const descriptionUpdatedAt = description ? now : null;
      const extractionStatus = input.extractionStatus ?? 'none';
      const extractedText = input.extractedText ?? null;
      const extractedTextSha256 = input.extractedTextSha256 ?? null;
      const linkModified = input.lastModified ?? now;

      let linkId: string;
      let groupSiblings: GroupSibling[] = [];
      if (existingLink) {
        linkId = existingLink.id;
        // Bug 155: an overwrite is a write of BYTES. A caller that says
        // nothing about the caption has no opinion about it, and blanking it
        // here is silent data loss — `docs write --force` over a described
        // image, a re-upload onto the same path, a mirror push from disk. So
        // the metadata columns join the SET clause only when their input field
        // is actually present; an explicit `''` still clears.
        const sets: string[] = [
          'fileId = ?', 'folderId = ?',
          'originalFileName = ?', 'originalMimeType = ?',
        ];
        const values: unknown[] = [
          fileRow.id, folderId,
          input.originalFileName, input.originalMimeType,
        ];
        if (input.description !== undefined) {
          sets.push('description = ?', 'descriptionUpdatedAt = ?');
          values.push(description, descriptionUpdatedAt);
        }
        if (input.extractedText !== undefined) {
          sets.push('extractedText = ?', 'extractedTextSha256 = ?');
          values.push(extractedText, extractedTextSha256);
        }
        if (input.extractionStatus !== undefined) {
          sets.push('extractionStatus = ?');
          values.push(extractionStatus);
        }
        sets.push('lastModified = ?', 'updatedAt = ?');
        values.push(linkModified, now, linkId);
        db.prepare(
          `UPDATE doc_mount_file_links SET ${sets.join(', ')} WHERE id = ?`
        ).run(...values as never[]);
        // Bytes are shared, so the whole group moves; each member keeps its own
        // description and extracted caption (null textState).
        groupSiblings = fanOutGroupFileId(db, existingLink.linkGroupId, linkId, fileRow.id, linkModified, now, null);
        if (existingLink.fileId !== fileRow.id) {
          gcOrphanedFileRow(db, existingLink.fileId);
        }
      } else {
        linkId = input.linkId ?? randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_file_links (
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
             ?, NULL, NULL,
             ?, ?, ?, NULL,
             0, ?, ?, ?
           )`
        ).run(
          linkId, fileRow.id, input.mountPointId, canonicalRel, input.fileName, folderId,
          input.originalFileName, input.originalMimeType,
          description, descriptionUpdatedAt,
          conversionStatus,
          extractedText, extractedTextSha256, extractionStatus,
          linkModified, input.createdAt ?? now, now
        );
      }

      return { fileRow: fileRow!, blobId, linkId, groupSiblings };
    });

    const { fileRow: finalFile, blobId, linkId, groupSiblings } = tx();

    if (groupSiblings.length > 0) {
      logger.debug('linkBlobContent: fanned write out to hard-link group', {
        linkId,
        siblings: groupSiblings.length,
        fileId: finalFile.id,
      });
    }

    const link = await this.findByIdWithContent(linkId);
    if (!link) {
      throw new Error(`Link disappeared immediately after upsert: ${linkId}`);
    }
    return { link, file: finalFile, blobId, groupSiblings };
  }

  /**
   * Write a text document into a database-backed mount as a hard-linkable
   * resource. Same dedup-by-sha rules as linkBlobContent.
   */
  async linkDocumentContent(input: LinkDocumentInput): Promise<{
    link: DocMountFileLinkWithContent;
    file: DocMountFile;
    documentId: string;
    /** Hard-link group members repointed by this write; each needs re-chunking. */
    groupSiblings: GroupSibling[];
  }> {
    const db = await this.ensureRawDb();

    const now = new Date().toISOString();

    let fileRow = db.prepare(
      `SELECT id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt
       FROM doc_mount_files WHERE sha256 = ?`
    ).get(input.contentSha256) as DocMountFile | undefined;

    const tx = db.transaction(() => {
      if (!fileRow) {
        const id = input.fileId ?? randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_files (id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 'database', ?, ?)`
        ).run(id, input.contentSha256, input.fileSizeBytes, input.fileType, now, now);
        fileRow = {
          id,
          sha256: input.contentSha256,
          fileSizeBytes: input.fileSizeBytes,
          fileType: input.fileType,
          source: 'database',
          createdAt: now,
          updatedAt: now,
        };
      }

      const existingDoc = db.prepare(
        `SELECT id FROM doc_mount_documents WHERE fileId = ?`
      ).get(fileRow.id) as { id: string } | undefined;
      let documentId: string;
      if (existingDoc) {
        documentId = existingDoc.id;
      } else {
        documentId = input.documentId ?? randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_documents (
             id, fileId, content, contentSha256, plainTextLength, createdAt, updatedAt
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(documentId, fileRow.id, input.content, input.contentSha256, input.plainTextLength, now, now);
      }

      // Derive folderId from relativePath (see linkBlobContent for rationale,
      // including the canonical stored-casing directory).
      const { folderId, canonicalDir } = ensureLinkFolderId(db, input.mountPointId, input.relativePath, now);
      const canonicalRel = canonicalDir ? `${canonicalDir}/${input.fileName}` : input.fileName;
      if (input.folderId !== undefined && input.folderId !== folderId) {
        logger.warn('linkDocumentContent: caller folderId disagrees with relativePath; using derived', {
          mountPointId: input.mountPointId,
          relativePath: input.relativePath,
          callerFolderId: input.folderId,
          derivedFolderId: folderId,
        });
      }

      // Case-insensitive, case-preserving upsert: a write to `NOTES.md`
      // updates the row stored as `notes.md` and keeps its casing.
      const existingLink = db.prepare(
        `SELECT id, fileId, linkGroupId FROM doc_mount_file_links
         WHERE mountPointId = ? AND relativePath = ? COLLATE NOCASE`
      ).get(input.mountPointId, canonicalRel) as
        { id: string; fileId: string; linkGroupId: string | null } | undefined;

      // Per-document policy. For markdown, derive it from the frontmatter in
      // `content` unless the caller passed explicit flags; other native text
      // (txt/json) carries no policy frontmatter → permissive. This keeps every
      // database write self-correcting, including in-child autonomous writes
      // that never reach the reindex pass.
      const parsedPolicy = input.fileType === 'markdown'
        ? policyFromContent(input.content)
        : DEFAULT_DOCUMENT_POLICY;
      const allowEmbed = (input.allowEmbed ?? parsedPolicy.embed) ? 1 : 0;
      const allowCharacterRead = (input.allowCharacterRead ?? parsedPolicy.characterRead) ? 1 : 0;
      const allowCharacterWrite = (input.allowCharacterWrite ?? parsedPolicy.characterWrite) ? 1 : 0;

      const linkModified = input.lastModified ?? now;

      let linkId: string;
      let groupSiblings: GroupSibling[] = [];
      let contentChanged = false;
      if (existingLink) {
        linkId = existingLink.id;
        // Bug 156: repointing the link at different content invalidates every
        // chunk built from the old revision. Chunks are keyed by linkId and
        // cascade only on link *deletion*, so without this the stale rows
        // survive an overwrite and keep answering semantic search — and the
        // link would claim `chunkCount > 0, converted`, which is exactly the
        // predicate `rescanDatabaseMountPoint` uses to decide it has nothing
        // to do. Dropping the rows and zeroing the count makes the overwrite
        // announce itself: writers that re-chunk immediately
        // (`writeDatabaseDocument` on the parent) set the real count back
        // moments later; writers that do not — the byte-preserving file-ops
        // path, and every in-child `doc_write_file` — are caught by the next
        // rescan instead of never.
        contentChanged = existingLink.fileId !== fileRow.id;
        if (contentChanged) {
          dropChunksForLinks(db, [linkId]);
        }
        db.prepare(
          `UPDATE doc_mount_file_links SET
             fileId = ?, folderId = ?,
             plainTextLength = ?,
             conversionStatus = 'converted', conversionError = NULL,
             allowEmbed = ?, allowCharacterRead = ?, allowCharacterWrite = ?,
             ${contentChanged ? 'chunkCount = 0,' : ''}
             lastModified = ?, updatedAt = ?
           WHERE id = ?`
        ).run(
          fileRow.id, folderId,
          input.plainTextLength,
          allowEmbed, allowCharacterRead, allowCharacterWrite,
          linkModified, now, linkId
        );
        // Deliberate hard links move together, then the abandoned content row
        // (if this write orphaned it) is collected.
        groupSiblings = fanOutGroupFileId(db, existingLink.linkGroupId, linkId, fileRow.id, linkModified, now, {
          plainTextLength: input.plainTextLength,
          allowEmbed, allowCharacterRead, allowCharacterWrite,
        });
        if (contentChanged) {
          gcOrphanedFileRow(db, existingLink.fileId);
        }
      } else {
        linkId = input.linkId ?? randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_file_links (
             id, fileId, mountPointId, relativePath, fileName, folderId,
             conversionStatus, plainTextLength,
             allowEmbed, allowCharacterRead, allowCharacterWrite,
             chunkCount, lastModified, createdAt, updatedAt
           ) VALUES (
             ?, ?, ?, ?, ?, ?,
             'converted', ?,
             ?, ?, ?,
             0, ?, ?, ?
           )`
        ).run(
          linkId, fileRow.id, input.mountPointId, canonicalRel, input.fileName, folderId,
          input.plainTextLength,
          allowEmbed, allowCharacterRead, allowCharacterWrite,
          linkModified, input.createdAt ?? now, now
        );
      }

      return { fileRow: fileRow!, documentId, linkId, groupSiblings, chunksDropped: contentChanged };
    });

    const { fileRow: finalFile, documentId, linkId, groupSiblings, chunksDropped } = tx();

    if (chunksDropped) {
      // The rows this write deleted are cached per mount (and a fanned-out
      // sibling may live in another one), so drop every affected mount's
      // cached chunk set or search keeps serving the old revision from memory.
      invalidateMountPoint(input.mountPointId);
      for (const mountId of new Set(groupSiblings.map(sib => sib.mountPointId))) {
        invalidateMountPoint(mountId);
      }
    }

    if (groupSiblings.length > 0) {
      logger.debug('linkDocumentContent: fanned write out to hard-link group', {
        linkId,
        siblings: groupSiblings.length,
        fileId: finalFile.id,
      });
    }

    const link = await this.findByIdWithContent(linkId);
    if (!link) {
      throw new Error(`Link disappeared immediately after upsert: ${linkId}`);
    }
    return { link, file: finalFile, documentId, groupSiblings };
  }

  /**
   * Register (or update) a link for a filesystem-source file. Used by the
   * scanner: the bytes already live on disk under the mount's basePath, so
   * we only record the file row + link row. Filesystem-source files are
   * constrained to one link (enforced via create() when a second link is
   * attempted).
   */
  async linkFilesystemFile(input: LinkFilesystemFileInput): Promise<DocMountFileLinkWithContent> {
    const db = await this.ensureRawDb();

    const now = new Date().toISOString();

    const source: FileSource = input.source ?? 'filesystem';
    let fileRow = db.prepare(
      `SELECT id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt
       FROM doc_mount_files WHERE sha256 = ? AND source = ?`
    ).get(input.sha256, source) as DocMountFile | undefined;

    const tx = db.transaction(() => {
      if (!fileRow) {
        const id = randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_files (id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(id, input.sha256, input.fileSizeBytes, input.fileType, source, now, now);
        fileRow = {
          id,
          sha256: input.sha256,
          fileSizeBytes: input.fileSizeBytes,
          fileType: input.fileType,
          source,
          createdAt: now,
          updatedAt: now,
        };
      }

      // Derive folderId from relativePath (see linkBlobContent for rationale).
      // The scanner calls this without passing folderId at all, so this
      // derivation is the only place new filesystem-scan rows get a sensible
      // folderId.
      const { folderId } = ensureLinkFolderId(db, input.mountPointId, input.relativePath, now);
      if (input.folderId !== undefined && input.folderId !== null && input.folderId !== folderId) {
        logger.warn('linkFilesystemFile: caller folderId disagrees with relativePath; using derived', {
          mountPointId: input.mountPointId,
          relativePath: input.relativePath,
          callerFolderId: input.folderId,
          derivedFolderId: folderId,
        });
      }

      // NOCASE match so a case-only rename on disk updates the existing row
      // instead of minting a case-variant duplicate. Unlike the database-store
      // writers, the update below ADOPTS the scanned casing — the filesystem
      // is the source of truth for these rows.
      const existingLink = db.prepare(
        `SELECT id FROM doc_mount_file_links WHERE mountPointId = ? AND relativePath = ? COLLATE NOCASE`
      ).get(input.mountPointId, input.relativePath) as { id: string } | undefined;

      let linkId: string;
      const conversionStatus = input.conversionStatus ?? 'pending';
      const plainTextLength = input.plainTextLength ?? null;
      const chunkCount = input.chunkCount ?? 0;
      // Per-document policy (markdown frontmatter). Default permissive; the
      // scanner/reindex passes parsed flags for markdown, nothing for others.
      const allowEmbed = input.allowEmbed === false ? 0 : 1;
      const allowCharacterRead = input.allowCharacterRead === false ? 0 : 1;
      const allowCharacterWrite = input.allowCharacterWrite === false ? 0 : 1;

      if (existingLink) {
        linkId = existingLink.id;
        db.prepare(
          `UPDATE doc_mount_file_links SET
             fileId = ?, relativePath = ?, fileName = ?, folderId = ?,
             conversionStatus = ?, conversionError = ?,
             plainTextLength = ?, chunkCount = ?,
             allowEmbed = ?, allowCharacterRead = ?, allowCharacterWrite = ?,
             lastModified = ?, updatedAt = ?
           WHERE id = ?`
        ).run(
          fileRow.id, input.relativePath, input.fileName, folderId,
          conversionStatus, input.conversionError ?? null,
          plainTextLength, chunkCount,
          allowEmbed, allowCharacterRead, allowCharacterWrite,
          input.lastModified, now, linkId
        );
      } else {
        linkId = randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_file_links (
             id, fileId, mountPointId, relativePath, fileName, folderId,
             conversionStatus, conversionError, plainTextLength,
             allowEmbed, allowCharacterRead, allowCharacterWrite,
             chunkCount, lastModified, createdAt, updatedAt
           ) VALUES (
             ?, ?, ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?, ?
           )`
        ).run(
          linkId, fileRow.id, input.mountPointId, input.relativePath, input.fileName, folderId,
          conversionStatus, input.conversionError ?? null, plainTextLength,
          allowEmbed, allowCharacterRead, allowCharacterWrite,
          chunkCount, input.lastModified, now, now
        );
      }

      return linkId;
    });

    const linkId = tx();
    const link = await this.findByIdWithContent(linkId);
    if (!link) {
      throw new Error(`Link disappeared immediately after upsert: ${linkId}`);
    }
    return link;
  }

  /**
   * Reconciliation sweep: delete any doc_mount_files row that has no
   * surviving links. Run on demand from the scan runner or the CLI when we
   * suspect a writer bypassed deleteWithGC.
   */
  async sweepOrphanedFiles(): Promise<number> {
    return this.withRawDb(
      0,
      async (db) => {
        const res = db.prepare(
          `DELETE FROM doc_mount_files
           WHERE id NOT IN (SELECT DISTINCT fileId FROM doc_mount_file_links)`
        ).run();
        if (res.changes > 0) {
          logger.info('Swept orphaned doc_mount_files rows', { count: res.changes });
        }
        return res.changes;
      },
      'Error sweeping orphaned files',
      {}
    );
  }

  /**
   * Reaper for store children stranded when their mount point vanished — the
   * orphans a pre-Bug-9 non-atomic store delete (or a hand-built index) minted.
   * Read connections keep foreign keys off, so these `doc_mount_file_links` /
   * `doc_mount_folders` / `doc_mount_documents` rows sit silent until a backup
   * carries them into a restore where constraints are live, which then fails
   * with `FOREIGN KEY constraint failed`. Runs at boot and joined to the daily
   * maintenance sweep.
   *
   * Healthy rows (whose mount point still exists) are untouched. Documents are
   * keyed by fileId, not mountPointId, so they are reaped once their file has
   * no surviving link — which the link reap above may have just caused.
   */
  async sweepOrphanedStoreChildren(): Promise<OrphanedStoreChildrenSwept> {
    return this.withRawDb(
      { links: 0, folders: 0, documents: 0 },
      async (db) => {
        const swept = reapOrphanedStoreChildren(db);
        if (swept.links > 0 || swept.folders > 0 || swept.documents > 0) {
          logger.info('Swept orphaned doc-store children', swept);
        } else {
          logger.debug('Swept orphaned doc-store children (none found)');
        }
        return swept;
      },
      'Error sweeping orphaned store children',
      {}
    );
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  /**
   * Run a SELECT against the joined link+file view. Caller supplies the
   * WHERE clause (relative to aliases `l` for links and `f` for files) and
   * the bound parameters.
   */
  private async queryJoined(whereClause: string, params: unknown[]): Promise<DocMountFileLinkWithContent[]> {
    return this.withRawDb(
      [],
      (db) => {
        const sql = `
          SELECT
            l.id, l.fileId, l.mountPointId, l.relativePath, l.fileName,
            l.folderId, l.originalFileName, l.originalMimeType,
            l.description, l.descriptionUpdatedAt,
            l.conversionStatus, l.conversionError, l.plainTextLength,
            l.extractedText, l.extractedTextSha256, l.extractionStatus, l.extractionError,
            l.chunkCount, l.allowEmbed, l.allowCharacterRead, l.allowCharacterWrite,
            l.linkGroupId,
            l.lastModified, l.createdAt, l.updatedAt,
            f.sha256, f.fileSizeBytes, f.fileType, f.source
          FROM doc_mount_file_links l
          JOIN doc_mount_files f ON f.id = l.fileId
          ${whereClause}
        `;

        const rows = db.prepare(sql).all(...params) as JoinedRow[];
        return rows.map(row => ({
          id: row.id,
          fileId: row.fileId,
          mountPointId: row.mountPointId,
          relativePath: row.relativePath,
          fileName: row.fileName,
          folderId: row.folderId ?? null,
          originalFileName: row.originalFileName ?? null,
          originalMimeType: row.originalMimeType ?? null,
          description: row.description ?? '',
          descriptionUpdatedAt: row.descriptionUpdatedAt ?? null,
          conversionStatus: row.conversionStatus,
          conversionError: row.conversionError ?? null,
          plainTextLength: row.plainTextLength ?? null,
          extractedText: row.extractedText ?? null,
          extractedTextSha256: row.extractedTextSha256 ?? null,
          extractionStatus: row.extractionStatus,
          extractionError: row.extractionError ?? null,
          chunkCount: row.chunkCount ?? 0,
          // SQLite stores these as 0/1; coerce to booleans (mirrors `enabled`).
          // Absent (pre-migration drift before the align guard runs) → permissive.
          allowEmbed: coerceAllow(row.allowEmbed),
          allowCharacterRead: coerceAllow(row.allowCharacterRead),
          allowCharacterWrite: coerceAllow(row.allowCharacterWrite),
          // Hard-link group id. Without this in the projection, every joined read
          // reported linkGroupId: undefined and reindexLinkGroupSiblings dead-ended
          // its early-out, so hard-linked siblings served stale chunks (Bug 15).
          linkGroupId: row.linkGroupId ?? null,
          lastModified: row.lastModified,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          sha256: row.sha256,
          fileSizeBytes: row.fileSizeBytes,
          fileType: row.fileType,
          source: row.source,
        }));
      },
      'Error querying joined file links',
      { whereClause },
    );
  }

}
