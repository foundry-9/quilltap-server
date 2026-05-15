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

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import {
  DocMountFile,
  DocMountFileLink,
  DocMountFileLinkSchema,
  DocMountFileLinkWithContent,
} from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';
import { generateDDL, extractSchemaMetadata } from '../schema-translator';
import { invalidateMountPoint } from '@/lib/mount-index/mount-chunk-cache';

export type FileType = DocMountFile['fileType'];
export type FileSource = DocMountFile['source'];

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
  sha256: string;
  /** Already-transcoded bytes destined for doc_mount_blobs. */
  data: Buffer;
  description?: string;
  conversionStatus?: DocMountFileLink['conversionStatus'];
  /** Set when the caller has already extracted text (e.g. PDF). */
  extractedText?: string | null;
  extractedTextSha256?: string | null;
  extractionStatus?: DocMountFileLink['extractionStatus'];
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
}

// Raw SQLite row shape for the joined SELECT (link.* + file content fields).
// Strings/numbers — booleans aren't part of this row, so no coercion needed
// beyond the JSON-decoded columns the SQLiteCollection helper handles for us.
type JoinedRow = DocMountFileLink & Pick<DocMountFile, 'sha256' | 'fileSizeBytes' | 'fileType' | 'source'>;

export class DocMountFileLinksRepository extends AbstractBaseRepository<DocMountFileLink> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('doc_mount_file_links', DocMountFileLinkSchema);
  }

  protected async getCollection(): Promise<DatabaseCollection<DocMountFileLink>> {
    if (isMountIndexDegraded()) {
      throw new Error('Mount index database is in degraded mode');
    }

    const db = getRawMountIndexDatabase();
    if (!db) {
      throw new Error('Mount index database not initialized');
    }

    if (!this.mountIndexCollectionInitialized) {
      try {
        const ddlStatements = generateDDL(this.collectionName, this.schema);
        for (const sql of ddlStatements) {
          db.exec(sql);
        }

        // (mountPointId, relativePath) replaces the advisory uniqueness the
        // old doc_mount_files row carried via app-level lookup. Now enforced.
        db.exec(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${this.collectionName}_mp_path" ` +
          `ON "${this.collectionName}" ("mountPointId", "relativePath")`
        );
        db.exec(
          `CREATE INDEX IF NOT EXISTS "idx_${this.collectionName}_fileId" ` +
          `ON "${this.collectionName}" ("fileId")`
        );
        db.exec(
          `CREATE INDEX IF NOT EXISTS "idx_${this.collectionName}_mountPointId" ` +
          `ON "${this.collectionName}" ("mountPointId")`
        );

        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure doc_mount_file_links table in mount index database', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const metadata = extractSchemaMetadata(this.collectionName, this.schema);
    const jsonColumns = metadata.fields
      .filter(f => f.type === 'array' || f.type === 'object')
      .map(f => f.name);
    const arrayColumns = metadata.fields
      .filter(f => f.type === 'array')
      .map(f => f.name);
    const booleanColumns = metadata.fields
      .filter(f => f.type === 'boolean')
      .map(f => f.name);

    return new SQLiteCollection<DocMountFileLink>(db, this.collectionName, jsonColumns, arrayColumns, booleanColumns);
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
    const db = getRawMountIndexDatabase();
    if (db) {
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
    }
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
   * Count links pointing at a file. Used by GC to decide whether to
   * tombstone the file row after a link delete.
   */
  async countByFileId(fileId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return 0;
        const row = db.prepare(
          'SELECT COUNT(*) AS count FROM doc_mount_file_links WHERE fileId = ?'
        ).get(fileId) as { count: number } | undefined;
        return row?.count ?? 0;
      },
      'Error counting file links by file ID',
      { fileId },
      0
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
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return { fileId: null, fileGC: false };

        const link = db.prepare(
          'SELECT fileId, mountPointId FROM doc_mount_file_links WHERE id = ?'
        ).get(linkId) as { fileId: string; mountPointId: string } | undefined;

        if (!link) {
          return { fileId: null, fileGC: false };
        }

        const tx = db.transaction(() => {
          // Chunks cascade via FK ON DELETE CASCADE, but invalidate the
          // mount-chunk cache for this mount before the row vanishes.
          db.prepare('DELETE FROM doc_mount_file_links WHERE id = ?').run(linkId);

          const remaining = db.prepare(
            'SELECT COUNT(*) AS count FROM doc_mount_file_links WHERE fileId = ?'
          ).get(link.fileId) as { count: number };

          if (remaining.count === 0) {
            // Last link gone — drop the file row. Documents/blobs cascade.
            db.prepare('DELETE FROM doc_mount_files WHERE id = ?').run(link.fileId);
            return true;
          }
          return false;
        });

        const fileGC = tx();
        invalidateMountPoint(link.mountPointId);
        return { fileId: link.fileId, fileGC };
      },
      'Error deleting file link with GC',
      { linkId },
      { fileId: null, fileGC: false }
    );
  }

  /**
   * Bulk delete every link for a mount point, running GC against the
   * underlying file rows. Returns count of links deleted and count of
   * files garbage-collected.
   */
  async deleteByMountPointId(mountPointId: string): Promise<{ linksDeleted: number; filesGC: number }> {
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return { linksDeleted: 0, filesGC: 0 };

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
      { mountPointId },
      { linksDeleted: 0, filesGC: 0 }
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
  async linkBlobContent(input: LinkBlobInput): Promise<{
    link: DocMountFileLinkWithContent;
    file: DocMountFile;
    blobId: string;
  }> {
    const db = getRawMountIndexDatabase();
    if (!db) throw new Error('Mount index database not initialized');

    // Ensure all relevant tables are initialized via repository getCollection
    // calls. Cheap when the tables already exist.
    await this.getCollection();

    const now = new Date().toISOString();
    const sizeBytes = input.data.length;

    // Find-or-create the content row by sha. UUID stability invariant: if
    // a content row already exists for these bytes, reuse its id.
    let fileRow = db.prepare(
      `SELECT id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt
       FROM doc_mount_files WHERE sha256 = ?`
    ).get(input.sha256) as DocMountFile | undefined;

    const fileType: FileType = input.fileType ?? 'blob';
    // Default per-link conversion lifecycle: blob fileType has no chunkable
    // text (skipped), pdf/docx start out pending and the conversion runner
    // picks them up later.
    const conversionStatus =
      input.conversionStatus ?? (fileType === 'blob' ? 'skipped' : 'pending');

    const tx = db.transaction(() => {
      if (!fileRow) {
        const id = randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_files (id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 'database', ?, ?)`
        ).run(id, input.sha256, sizeBytes, fileType, now, now);
        fileRow = {
          id,
          sha256: input.sha256,
          fileSizeBytes: sizeBytes,
          fileType,
          source: 'database',
          createdAt: now,
          updatedAt: now,
        };
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
        blobId = randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_blobs (id, fileId, sha256, sizeBytes, storedMimeType, data, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(blobId, fileRow.id, input.sha256, sizeBytes, input.storedMimeType, input.data, now, now);
      }

      // Upsert the link row. The UNIQUE(mountPointId, relativePath) index
      // means a second write to the same path overwrites the existing
      // link's metadata in place rather than creating a duplicate.
      const existingLink = db.prepare(
        `SELECT id FROM doc_mount_file_links WHERE mountPointId = ? AND relativePath = ?`
      ).get(input.mountPointId, input.relativePath) as { id: string } | undefined;

      const description = input.description ?? '';
      const descriptionUpdatedAt = description ? now : null;
      const extractionStatus = input.extractionStatus ?? 'none';
      const extractedText = input.extractedText ?? null;
      const extractedTextSha256 = input.extractedTextSha256 ?? null;

      let linkId: string;
      if (existingLink) {
        linkId = existingLink.id;
        db.prepare(
          `UPDATE doc_mount_file_links SET
             fileId = ?, fileName = ?, folderId = ?,
             originalFileName = ?, originalMimeType = ?,
             description = ?, descriptionUpdatedAt = ?,
             extractedText = ?, extractedTextSha256 = ?, extractionStatus = ?,
             lastModified = ?, updatedAt = ?
           WHERE id = ?`
        ).run(
          fileRow.id, input.fileName, input.folderId,
          input.originalFileName, input.originalMimeType,
          description, descriptionUpdatedAt,
          extractedText, extractedTextSha256, extractionStatus,
          now, now, linkId
        );
      } else {
        linkId = randomUUID();
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
          linkId, fileRow.id, input.mountPointId, input.relativePath, input.fileName, input.folderId,
          input.originalFileName, input.originalMimeType,
          description, descriptionUpdatedAt,
          conversionStatus,
          extractedText, extractedTextSha256, extractionStatus,
          now, now, now
        );
      }

      return { fileRow: fileRow!, blobId, linkId };
    });

    const { fileRow: finalFile, blobId, linkId } = tx();

    const link = await this.findByIdWithContent(linkId);
    if (!link) {
      throw new Error(`Link disappeared immediately after upsert: ${linkId}`);
    }
    return { link, file: finalFile, blobId };
  }

  /**
   * Write a text document into a database-backed mount as a hard-linkable
   * resource. Same dedup-by-sha rules as linkBlobContent.
   */
  async linkDocumentContent(input: LinkDocumentInput): Promise<{
    link: DocMountFileLinkWithContent;
    file: DocMountFile;
    documentId: string;
  }> {
    const db = getRawMountIndexDatabase();
    if (!db) throw new Error('Mount index database not initialized');

    await this.getCollection();

    const now = new Date().toISOString();

    let fileRow = db.prepare(
      `SELECT id, sha256, fileSizeBytes, fileType, source, createdAt, updatedAt
       FROM doc_mount_files WHERE sha256 = ?`
    ).get(input.contentSha256) as DocMountFile | undefined;

    const tx = db.transaction(() => {
      if (!fileRow) {
        const id = randomUUID();
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
        documentId = randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_documents (
             id, fileId, content, contentSha256, plainTextLength, createdAt, updatedAt
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(documentId, fileRow.id, input.content, input.contentSha256, input.plainTextLength, now, now);
      }

      const existingLink = db.prepare(
        `SELECT id FROM doc_mount_file_links WHERE mountPointId = ? AND relativePath = ?`
      ).get(input.mountPointId, input.relativePath) as { id: string } | undefined;

      let linkId: string;
      if (existingLink) {
        linkId = existingLink.id;
        db.prepare(
          `UPDATE doc_mount_file_links SET
             fileId = ?, fileName = ?, folderId = ?,
             plainTextLength = ?,
             conversionStatus = 'converted', conversionError = NULL,
             lastModified = ?, updatedAt = ?
           WHERE id = ?`
        ).run(
          fileRow.id, input.fileName, input.folderId,
          input.plainTextLength,
          now, now, linkId
        );
      } else {
        linkId = randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_file_links (
             id, fileId, mountPointId, relativePath, fileName, folderId,
             conversionStatus, plainTextLength,
             chunkCount, lastModified, createdAt, updatedAt
           ) VALUES (
             ?, ?, ?, ?, ?, ?,
             'converted', ?,
             0, ?, ?, ?
           )`
        ).run(
          linkId, fileRow.id, input.mountPointId, input.relativePath, input.fileName, input.folderId,
          input.plainTextLength, now, now, now
        );
      }

      return { fileRow: fileRow!, documentId, linkId };
    });

    const { fileRow: finalFile, documentId, linkId } = tx();

    const link = await this.findByIdWithContent(linkId);
    if (!link) {
      throw new Error(`Link disappeared immediately after upsert: ${linkId}`);
    }
    return { link, file: finalFile, documentId };
  }

  /**
   * Register (or update) a link for a filesystem-source file. Used by the
   * scanner: the bytes already live on disk under the mount's basePath, so
   * we only record the file row + link row. Filesystem-source files are
   * constrained to one link (enforced via create() when a second link is
   * attempted).
   */
  async linkFilesystemFile(input: LinkFilesystemFileInput): Promise<DocMountFileLinkWithContent> {
    const db = getRawMountIndexDatabase();
    if (!db) throw new Error('Mount index database not initialized');

    await this.getCollection();

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

      const existingLink = db.prepare(
        `SELECT id FROM doc_mount_file_links WHERE mountPointId = ? AND relativePath = ?`
      ).get(input.mountPointId, input.relativePath) as { id: string } | undefined;

      let linkId: string;
      const conversionStatus = input.conversionStatus ?? 'pending';
      const plainTextLength = input.plainTextLength ?? null;
      const chunkCount = input.chunkCount ?? 0;

      if (existingLink) {
        linkId = existingLink.id;
        db.prepare(
          `UPDATE doc_mount_file_links SET
             fileId = ?, fileName = ?, folderId = ?,
             conversionStatus = ?, conversionError = ?,
             plainTextLength = ?, chunkCount = ?,
             lastModified = ?, updatedAt = ?
           WHERE id = ?`
        ).run(
          fileRow.id, input.fileName, input.folderId ?? null,
          conversionStatus, input.conversionError ?? null,
          plainTextLength, chunkCount,
          input.lastModified, now, linkId
        );
      } else {
        linkId = randomUUID();
        db.prepare(
          `INSERT INTO doc_mount_file_links (
             id, fileId, mountPointId, relativePath, fileName, folderId,
             conversionStatus, conversionError, plainTextLength,
             chunkCount, lastModified, createdAt, updatedAt
           ) VALUES (
             ?, ?, ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?, ?
           )`
        ).run(
          linkId, fileRow.id, input.mountPointId, input.relativePath, input.fileName, input.folderId ?? null,
          conversionStatus, input.conversionError ?? null, plainTextLength,
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
    logger.debug('Filesystem link upserted', { linkId, sha256: input.sha256, mountPointId: input.mountPointId });
    return link;
  }

  /**
   * Reconciliation sweep: delete any doc_mount_files row that has no
   * surviving links. Run on demand from the scan runner or the CLI when we
   * suspect a writer bypassed deleteWithGC.
   */
  async sweepOrphanedFiles(): Promise<number> {
    return this.safeQuery(
      async () => {
        const db = getRawMountIndexDatabase();
        if (!db) return 0;
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
      {},
      0
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
    const db = getRawMountIndexDatabase();
    if (!db) return [];

    // Make sure the tables exist (calling getCollection runs the DDL).
    await this.getCollection();

    const sql = `
      SELECT
        l.id, l.fileId, l.mountPointId, l.relativePath, l.fileName,
        l.folderId, l.originalFileName, l.originalMimeType,
        l.description, l.descriptionUpdatedAt,
        l.conversionStatus, l.conversionError, l.plainTextLength,
        l.extractedText, l.extractedTextSha256, l.extractionStatus, l.extractionError,
        l.chunkCount, l.lastModified, l.createdAt, l.updatedAt,
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
      lastModified: row.lastModified,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      sha256: row.sha256,
      fileSizeBytes: row.fileSizeBytes,
      fileType: row.fileType,
      source: row.source,
    }));
  }

}
