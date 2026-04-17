/**
 * Document Mount Files Repository
 *
 * Backend-agnostic repository for DocMountFile entities.
 * Overrides getCollection() to route all operations to the dedicated
 * mount index database (quilltap-mount-index.db), isolating document
 * mount tracking data from the main database.
 *
 * When the mount index DB is in degraded mode (corruption, permissions, etc.),
 * getCollection() throws and all safeQuery fallbacks kick in — returning
 * empty arrays, null, etc. The rest of the app continues normally.
 */

import { logger } from '@/lib/logger';
import { DocMountFile, DocMountFileSchema } from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';
import { generateDDL, extractSchemaMetadata } from '../schema-translator';

/**
 * Document Mount Files Repository
 * Implements CRUD operations and queries for document mount files.
 * Uses the mount index database instead of the main database.
 */
export class DocMountFilesRepository extends AbstractBaseRepository<DocMountFile> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('doc_mount_files', DocMountFileSchema);
  }

  /**
   * Override getCollection to return a collection from the dedicated mount index
   * database instead of the main database.
   */
  protected async getCollection(): Promise<DatabaseCollection<DocMountFile>> {
    if (isMountIndexDegraded()) {
      throw new Error('Mount index database is in degraded mode');
    }

    const db = getRawMountIndexDatabase();
    if (!db) {
      throw new Error('Mount index database not initialized');
    }

    // Ensure the table exists in the mount index DB on first access
    if (!this.mountIndexCollectionInitialized) {
      try {
        const ddlStatements = generateDDL(this.collectionName, this.schema);
        for (const sql of ddlStatements) {
          db.exec(sql);
        }

        // In-repo migration: add `source` column for legacy mount-index DBs that
        // predate database-backed document stores. Default 'filesystem' leaves
        // all existing indexed files pointing at on-disk content; new rows from
        // database-backed stores set it to 'database'.
        const columns = db.pragma(`table_info(${this.collectionName})`) as Array<{ name: string }>;
        if (!columns.some(c => c.name === 'source')) {
          db.exec(`ALTER TABLE "${this.collectionName}" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'filesystem'`);
          logger.info('Migrated doc_mount_files: added source column');
        }

        // In-repo migration: add `folderId` column for database-backed stores
        // with explicit folder tracking. Nullable, defaults to null for filesystem-backed stores.
        if (!columns.some(c => c.name === 'folderId')) {
          db.exec(`ALTER TABLE "${this.collectionName}" ADD COLUMN "folderId" TEXT DEFAULT NULL`);
          logger.info('Migrated doc_mount_files: added folderId column');
        }

        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure doc_mount_files table in mount index database', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    // Detect JSON, array, and boolean columns from schema
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

    return new SQLiteCollection<DocMountFile>(db, this.collectionName, jsonColumns, arrayColumns, booleanColumns);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async findById(id: string): Promise<DocMountFile | null> {
    return this._findById(id);
  }

  async findAll(): Promise<DocMountFile[]> {
    return this._findAll();
  }

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
  // Custom query methods
  // ============================================================================

  /**
   * Find all files for a mount point
   * @param mountPointId The mount point ID
   * @returns Promise<DocMountFile[]> Array of files for the mount point
   */
  async findByMountPointId(mountPointId: string): Promise<DocMountFile[]> {
    return this.safeQuery(
      async () => {
        logger.debug('Finding files by mount point ID', {
          context: 'DocMountFilesRepository.findByMountPointId',
          mountPointId,
        });
        const results = await this.findByFilter(
          { mountPointId } as TypedQueryFilter<DocMountFile>
        );
        logger.debug('Found files by mount point ID', {
          context: 'DocMountFilesRepository.findByMountPointId',
          mountPointId,
          count: results.length,
        });
        return results;
      },
      'Error finding files by mount point ID',
      { mountPointId },
      []
    );
  }

  /**
   * Find a specific file by mount point and relative path
   * @param mountPointId The mount point ID
   * @param relativePath The relative path within the mount point
   * @returns Promise<DocMountFile | null> The file if found
   */
  async findByMountPointAndPath(
    mountPointId: string,
    relativePath: string
  ): Promise<DocMountFile | null> {
    return this.safeQuery(
      async () => {
        logger.debug('Finding file by mount point and path', {
          context: 'DocMountFilesRepository.findByMountPointAndPath',
          mountPointId,
          relativePath,
        });
        const result = await this.findOneByFilter({
          mountPointId,
          relativePath,
        } as TypedQueryFilter<DocMountFile>);
        logger.debug('Find by mount point and path result', {
          context: 'DocMountFilesRepository.findByMountPointAndPath',
          mountPointId,
          relativePath,
          found: result !== null,
        });
        return result;
      },
      'Error finding file by mount point and path',
      { mountPointId, relativePath },
      null
    );
  }

  /**
   * Delete all files for a mount point
   * @param mountPointId The mount point ID
   * @returns Promise<number> Number of files deleted
   */
  async deleteByMountPointId(mountPointId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        logger.debug('Deleting files by mount point ID', {
          context: 'DocMountFilesRepository.deleteByMountPointId',
          mountPointId,
        });
        const count = await this.deleteMany(
          { mountPointId } as TypedQueryFilter<DocMountFile>
        );
        logger.debug('Deleted files by mount point ID', {
          context: 'DocMountFilesRepository.deleteByMountPointId',
          mountPointId,
          deletedCount: count,
        });
        return count;
      },
      'Error deleting files by mount point ID',
      { mountPointId }
    );
  }

  /**
   * Delete a file by its ID
   * @param id The file ID
   * @returns Promise<boolean> True if file was deleted, false if not found
   */
  async deleteByFileId(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        logger.debug('Deleting file by ID', {
          context: 'DocMountFilesRepository.deleteByFileId',
          id,
        });
        const result = await this._delete(id);
        logger.debug('Delete file by ID result', {
          context: 'DocMountFilesRepository.deleteByFileId',
          id,
          deleted: result,
        });
        return result;
      },
      'Error deleting file by ID',
      { id }
    );
  }
}
