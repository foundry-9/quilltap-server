/**
 * Document Mount Blobs Repository
 *
 * Stores binary assets (images first; any MIME type later) for all mount
 * point types — filesystem, obsidian, and database — inside the
 * quilltap-mount-index.db SQLCipher database. The `data` column holds raw
 * bytes as a SQLite BLOB, so this repository bypasses the generic
 * SQLiteCollection / AbstractBaseRepository machinery (which is designed
 * for JSON-shaped documents) and talks to better-sqlite3 directly.
 *
 * Callers normally use two separate APIs:
 *   - Metadata-only queries (list, findByPath, updateDescription) return
 *     DocMountBlobMetadata and are cheap.
 *   - readData() returns the raw Buffer and is only called when a blob is
 *     actually served to a client or handed to a tool.
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { DocMountBlobMetadata, DocMountBlobMetadataSchema } from '@/lib/schemas/mount-index.types';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';

const TABLE = 'doc_mount_blobs';

export interface CreateBlobInput {
  mountPointId: string;
  relativePath: string;
  originalFileName: string;
  originalMimeType: string;
  storedMimeType: string;
  sha256: string;
  description?: string;
  data: Buffer;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToMetadata(row: Record<string, unknown>): DocMountBlobMetadata {
  // Drop the `data` column if it leaked in — metadata queries should never
  // hydrate the blob bytes, but this guards against programmer error.
  const { data: _data, ...metadata } = row as Record<string, unknown> & { data?: Buffer };
  return DocMountBlobMetadataSchema.parse(metadata);
}

export class DocMountBlobsRepository {
  private tableInitialized = false;

  private db() {
    if (isMountIndexDegraded()) {
      throw new Error('Mount index database is in degraded mode');
    }
    const db = getRawMountIndexDatabase();
    if (!db) {
      throw new Error('Mount index database not initialized');
    }

    if (!this.tableInitialized) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS "${TABLE}" (
          "id" TEXT PRIMARY KEY,
          "mountPointId" TEXT NOT NULL,
          "relativePath" TEXT NOT NULL,
          "originalFileName" TEXT NOT NULL,
          "originalMimeType" TEXT NOT NULL,
          "storedMimeType" TEXT NOT NULL,
          "sizeBytes" INTEGER NOT NULL,
          "sha256" TEXT NOT NULL,
          "description" TEXT NOT NULL DEFAULT '',
          "descriptionUpdatedAt" TEXT,
          "data" BLOB NOT NULL,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL
        )
      `);
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${TABLE}_mp_path" ` +
        `ON "${TABLE}" ("mountPointId", "relativePath")`
      );
      db.exec(`CREATE INDEX IF NOT EXISTS "idx_${TABLE}_mp" ON "${TABLE}" ("mountPointId")`);
      this.tableInitialized = true;
    }

    return db;
  }

  async findById(id: string): Promise<DocMountBlobMetadata | null> {
    try {
      const row = this.db().prepare(
        `SELECT id, mountPointId, relativePath, originalFileName, originalMimeType,
                storedMimeType, sizeBytes, sha256, description, descriptionUpdatedAt,
                createdAt, updatedAt
         FROM "${TABLE}" WHERE id = ?`
      ).get(id) as Record<string, unknown> | undefined;
      return row ? rowToMetadata(row) : null;
    } catch (error) {
      logger.warn('Failed to find blob by id', { id, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async findByMountPointAndPath(
    mountPointId: string,
    relativePath: string
  ): Promise<DocMountBlobMetadata | null> {
    try {
      const row = this.db().prepare(
        `SELECT id, mountPointId, relativePath, originalFileName, originalMimeType,
                storedMimeType, sizeBytes, sha256, description, descriptionUpdatedAt,
                createdAt, updatedAt
         FROM "${TABLE}" WHERE mountPointId = ? AND relativePath = ?`
      ).get(mountPointId, relativePath) as Record<string, unknown> | undefined;
      return row ? rowToMetadata(row) : null;
    } catch (error) {
      logger.warn('Failed to find blob by path', {
        mountPointId,
        relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async listByMountPoint(
    mountPointId: string,
    options: { folder?: string } = {}
  ): Promise<DocMountBlobMetadata[]> {
    try {
      const db = this.db();
      let rows: Array<Record<string, unknown>>;
      const baseSelect =
        `SELECT id, mountPointId, relativePath, originalFileName, originalMimeType,
                storedMimeType, sizeBytes, sha256, description, descriptionUpdatedAt,
                createdAt, updatedAt
         FROM "${TABLE}" WHERE mountPointId = ?`;

      if (options.folder !== undefined) {
        const folderPrefix = options.folder.endsWith('/') ? options.folder : `${options.folder}/`;
        rows = db.prepare(`${baseSelect} AND relativePath LIKE ? ORDER BY relativePath ASC`)
          .all(mountPointId, `${folderPrefix}%`) as Array<Record<string, unknown>>;
      } else {
        rows = db.prepare(`${baseSelect} ORDER BY relativePath ASC`)
          .all(mountPointId) as Array<Record<string, unknown>>;
      }
      return rows.map(rowToMetadata);
    } catch (error) {
      logger.warn('Failed to list blobs by mount point', {
        mountPointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async readData(id: string): Promise<Buffer | null> {
    try {
      const row = this.db().prepare(
        `SELECT data FROM "${TABLE}" WHERE id = ?`
      ).get(id) as { data: Buffer } | undefined;
      return row ? row.data : null;
    } catch (error) {
      logger.warn('Failed to read blob data', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async create(input: CreateBlobInput): Promise<DocMountBlobMetadata> {
    const id = randomUUID();
    const now = nowIso();
    const description = input.description ?? '';
    const descriptionUpdatedAt = description ? now : null;
    const sizeBytes = input.data.length;

    const db = this.db();
    // Upsert on (mountPointId, relativePath) — callers expect writeBlob to
    // replace a blob at the same virtual path, matching fs.writeFile semantics.
    const existing = db.prepare(
      `SELECT id FROM "${TABLE}" WHERE mountPointId = ? AND relativePath = ?`
    ).get(input.mountPointId, input.relativePath) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE "${TABLE}" SET
           originalFileName = ?, originalMimeType = ?, storedMimeType = ?,
           sizeBytes = ?, sha256 = ?, description = ?, descriptionUpdatedAt = ?,
           data = ?, updatedAt = ?
         WHERE id = ?`
      ).run(
        input.originalFileName, input.originalMimeType, input.storedMimeType,
        sizeBytes, input.sha256, description, descriptionUpdatedAt,
        input.data, now, existing.id
      );
      logger.debug('Replaced existing blob', {
        mountPointId: input.mountPointId,
        relativePath: input.relativePath,
        sizeBytes,
      });
      const updated = await this.findById(existing.id);
      if (!updated) {
        throw new Error(`Blob disappeared after update: ${existing.id}`);
      }
      return updated;
    }

    db.prepare(
      `INSERT INTO "${TABLE}" (
         id, mountPointId, relativePath, originalFileName, originalMimeType,
         storedMimeType, sizeBytes, sha256, description, descriptionUpdatedAt,
         data, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, input.mountPointId, input.relativePath, input.originalFileName,
      input.originalMimeType, input.storedMimeType, sizeBytes, input.sha256,
      description, descriptionUpdatedAt, input.data, now, now
    );

    logger.debug('Created blob', {
      id,
      mountPointId: input.mountPointId,
      relativePath: input.relativePath,
      sizeBytes,
    });
    const created = await this.findById(id);
    if (!created) {
      throw new Error(`Blob disappeared immediately after creation: ${id}`);
    }
    return created;
  }

  async updateDescription(id: string, description: string): Promise<DocMountBlobMetadata | null> {
    try {
      const now = nowIso();
      this.db().prepare(
        `UPDATE "${TABLE}" SET description = ?, descriptionUpdatedAt = ?, updatedAt = ? WHERE id = ?`
      ).run(description, now, now, id);
      return await this.findById(id);
    } catch (error) {
      logger.warn('Failed to update blob description', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = this.db().prepare(`DELETE FROM "${TABLE}" WHERE id = ?`).run(id);
      return result.changes > 0;
    } catch (error) {
      logger.warn('Failed to delete blob', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async deleteByMountPointAndPath(mountPointId: string, relativePath: string): Promise<boolean> {
    try {
      const result = this.db().prepare(
        `DELETE FROM "${TABLE}" WHERE mountPointId = ? AND relativePath = ?`
      ).run(mountPointId, relativePath);
      return result.changes > 0;
    } catch (error) {
      logger.warn('Failed to delete blob by path', {
        mountPointId,
        relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async deleteByMountPointId(mountPointId: string): Promise<number> {
    try {
      const result = this.db().prepare(
        `DELETE FROM "${TABLE}" WHERE mountPointId = ?`
      ).run(mountPointId);
      return result.changes;
    } catch (error) {
      logger.warn('Failed to delete blobs by mount point', {
        mountPointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
