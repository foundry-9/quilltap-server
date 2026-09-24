/**
 * Document Mount Files Repository
 *
 * Backend-agnostic repository for DocMountFile entities — the **content row**
 * for files indexed by the mount-index DB. Identity is the bytes (sha256 is
 * UNIQUE). Location and per-link metadata live on doc_mount_file_links.
 *
 * Lives in the dedicated mount index database (quilltap-mount-index.db) via
 * `AbstractDedicatedDbRepository`. When the mount index DB is in degraded
 * mode, getCollection() throws and safeQuery fallbacks kick in.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  DocMountFile,
  DocMountFileLinkWithContent,
  DocMountFileSchema,
} from '@/lib/schemas/mount-index.types';
import { CreateOptions } from './base.repository';
import { AbstractDedicatedDbRepository } from './dedicated-db.repository';
import { TypedQueryFilter } from '../interfaces';
import { requireMountIndexDb } from '../backends/sqlite/mount-index-guard';

export class DocMountFilesRepository extends AbstractDedicatedDbRepository<DocMountFile> {
  constructor() {
    super('doc_mount_files', DocMountFileSchema, { dbTarget: 'mountIndex', acquireDb: requireMountIndexDb });
  }

  /**
   * Extra DDL, run once after the generated statements on first access.
   */
  protected override onTableEnsured(db: DatabaseType): void {
    // Sha256 lookup index. Not UNIQUE — existing instances may carry
    // duplicate sha rows that pre-date the content/link split (every
    // (mountPoint, relativePath) used to be its own file row, and the
    // migration deliberately keeps them rather than collapsing). Writers
    // call findOrCreateByContent to reuse on match.
    db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_mount_files_sha256 ON doc_mount_files (sha256)`);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<DocMountFile, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountFile> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<DocMountFile>): Promise<DocMountFile | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Content-addressable helpers
  // ============================================================================

  /**
   * Find a content row by sha256. Returns null if no row matches.
   */
  async findBySha256(sha256: string): Promise<DocMountFile | null> {
    return this.safeQuery(
      async () => this.findOneByFilter({ sha256 } as TypedQueryFilter<DocMountFile>),
      'Error finding file by sha256',
      { sha256 },
      null
    );
  }

  /**
   * Get-or-create a content row keyed by sha256. If a row with this sha
   * already exists, returns the existing row (and crucially its existing
   * UUID is preserved — hard-linkers depend on this stability). If not,
   * inserts a fresh content row with the supplied attributes.
   */
  async findOrCreateByContent(
    data: Omit<DocMountFile, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountFile> {
    const existing = await this.findBySha256(data.sha256);
    if (existing) {
      return existing;
    }
    return this._create(data, options);
  }

  // ============================================================================
  // Joined-view facades — most callers want "what files are at this mount?"
  // and naturally hit the file repo first. Delegate to the link table.
  // ============================================================================

  /**
   * Return joined link + content rows for a mount point. Mirrors the
   * legacy DocMountFile shape (with mountPointId, relativePath, fileName,
   * etc.) so existing callers continue to compile.
   */
  async findByMountPointId(mountPointId: string): Promise<DocMountFileLinkWithContent[]> {
    return this.withRawDb(
      [],
      async (db) => {
        return queryLinks(db, 'WHERE l.mountPointId = ?', [mountPointId]);
      },
      'Error finding files by mount point ID',
      { mountPointId }
    );
  }

  /**
   * Joined link + content row for a (mountPointId, relativePath) pair.
   */
  async findByMountPointAndPath(
    mountPointId: string,
    relativePath: string
  ): Promise<DocMountFileLinkWithContent | null> {
    return this.withRawDb(
      null,
      async (db) => {
        const rows = queryLinks(
          db,
          'WHERE l.mountPointId = ? AND LOWER(l.relativePath) = LOWER(?)',
          [mountPointId, relativePath]
        );
        return rows[0] ?? null;
      },
      'Error finding file by mount point and path',
      { mountPointId, relativePath }
    );
  }

  /**
   * Bulk delete every link for a mount point with GC of the underlying
   * file rows. Returns the count of links deleted.
   */
  async deleteByMountPointId(mountPointId: string): Promise<number> {
    return this.withRawDb(
      0,
      async (db) => {
        // Snapshot fileIds for GC.
        const affected = db.prepare(
          `SELECT DISTINCT fileId FROM doc_mount_file_links WHERE mountPointId = ?`
        ).all(mountPointId) as { fileId: string }[];

        let linksDeleted = 0;
        const tx = db.transaction(() => {
          const res = db.prepare(
            `DELETE FROM doc_mount_file_links WHERE mountPointId = ?`
          ).run(mountPointId);
          linksDeleted = res.changes;

          if (affected.length > 0) {
            const placeholders = affected.map(() => '?').join(',');
            const orphaned = db.prepare(
              `SELECT f.id FROM doc_mount_files f
               WHERE f.id IN (${placeholders})
                 AND NOT EXISTS (SELECT 1 FROM doc_mount_file_links l WHERE l.fileId = f.id)`
            ).all(...affected.map(a => a.fileId)) as { id: string }[];
            for (const f of orphaned) {
              db.prepare(`DELETE FROM doc_mount_files WHERE id = ?`).run(f.id);
            }
          }
        });
        tx();
        return linksDeleted;
      },
      'Error deleting files by mount point ID',
      { mountPointId },
      'rethrow'
    );
  }
}

/**
 * Shared helper: SELECT joined link + content rows. Identical projection to
 * DocMountFileLinksRepository.queryJoined but inlined here to keep the
 * facade independent of the link repo's class.
 */
function queryLinks(
  db: DatabaseType,
  whereClause: string,
  params: unknown[]
): DocMountFileLinkWithContent[] {
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
  return db.prepare(sql).all(...params) as DocMountFileLinkWithContent[];
}
