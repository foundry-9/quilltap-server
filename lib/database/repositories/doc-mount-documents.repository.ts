/**
 * Document Mount Documents Repository
 *
 * Stores the text content of documents for database-backed mount points
 * (mountType === 'database') inside quilltap-mount-index.db. Mirror rows
 * in doc_mount_files keep the scan/search/embedding pipeline agnostic of
 * where the bytes actually live.
 *
 * When the mount index DB is in degraded mode, getCollection() throws and
 * all safeQuery fallbacks kick in — matching the pattern used by the other
 * mount-index repositories.
 */

import { logger } from '@/lib/logger';
import { DocMountDocument, DocMountDocumentSchema } from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';
import { generateDDL, extractSchemaMetadata } from '../schema-translator';

export class DocMountDocumentsRepository extends AbstractBaseRepository<DocMountDocument> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('doc_mount_documents', DocMountDocumentSchema);
  }

  protected async getCollection(): Promise<DatabaseCollection<DocMountDocument>> {
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

        // (mountPointId, relativePath) is the natural key we look up by.
        db.exec(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${this.collectionName}_mp_path" ` +
          `ON "${this.collectionName}" ("mountPointId", "relativePath")`
        );

        // In-repo migration: add `folderId` column for explicit folder tracking.
        // Nullable, defaults to null.
        const columns = db.pragma(`table_info(${this.collectionName})`) as Array<{ name: string }>;
        if (!columns.some(c => c.name === 'folderId')) {
          db.exec(`ALTER TABLE "${this.collectionName}" ADD COLUMN "folderId" TEXT DEFAULT NULL`);
          logger.info('Migrated doc_mount_documents: added folderId column');
        }

        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure doc_mount_documents table in mount index database', {
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

    return new SQLiteCollection<DocMountDocument>(
      db, this.collectionName, jsonColumns, arrayColumns, booleanColumns
    );
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async findById(id: string): Promise<DocMountDocument | null> {
    return this._findById(id);
  }

  async findAll(): Promise<DocMountDocument[]> {
    return this._findAll();
  }

  async create(
    data: Omit<DocMountDocument, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountDocument> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<DocMountDocument>): Promise<DocMountDocument | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  async findByMountPointAndPath(
    mountPointId: string,
    relativePath: string
  ): Promise<DocMountDocument | null> {
    return this.safeQuery(
      async () => this.findOneByFilter({
        mountPointId,
        relativePath,
      } as TypedQueryFilter<DocMountDocument>),
      'Error finding document by mount point and path',
      { mountPointId, relativePath },
      null
    );
  }

  async findByMountPointId(mountPointId: string): Promise<DocMountDocument[]> {
    return this.safeQuery(
      async () => this.findByFilter({ mountPointId } as TypedQueryFilter<DocMountDocument>),
      'Error finding documents by mount point ID',
      { mountPointId },
      []
    );
  }

  async deleteByMountPointId(mountPointId: string): Promise<number> {
    return this.safeQuery(
      async () => this.deleteMany({ mountPointId } as TypedQueryFilter<DocMountDocument>),
      'Error deleting documents by mount point ID',
      { mountPointId }
    );
  }
}
