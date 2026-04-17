/**
 * Document Mount Folders Repository
 *
 * Manages explicit folder rows for database-backed mount points. Filesystem-backed
 * stores derive folder structure from the OS; database-backed stores maintain folders
 * as first-class rows with parent pointers and denormalised paths for fast lookup.
 *
 * When the mount index DB is in degraded mode, getCollection() throws and all
 * safeQuery fallbacks kick in — matching the pattern used by other mount-index repos.
 */

import { logger } from '@/lib/logger';
import { DocMountFolder, DocMountFolderSchema } from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';
import { generateDDL, extractSchemaMetadata } from '../schema-translator';

/**
 * Document Mount Folders Repository
 * Implements CRUD operations and queries for document mount folders.
 * Uses the mount index database instead of the main database.
 */
export class DocMountFoldersRepository extends AbstractBaseRepository<DocMountFolder> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('doc_mount_folders', DocMountFolderSchema);
  }

  /**
   * Override getCollection to return a collection from the dedicated mount index
   * database instead of the main database.
   */
  protected async getCollection(): Promise<DatabaseCollection<DocMountFolder>> {
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

        // Unique constraint on (mountPointId, COALESCE(parentId, ''), name)
        // The COALESCE is required because SQLite treats each NULL as distinct in UNIQUE indexes.
        db.exec(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${this.collectionName}_mp_parent_name" ` +
          `ON "${this.collectionName}" ("mountPointId", COALESCE("parentId", ''), "name")`
        );

        // Fast path lookup by (mountPointId, path)
        db.exec(
          `CREATE INDEX IF NOT EXISTS "idx_${this.collectionName}_mp_path" ` +
          `ON "${this.collectionName}" ("mountPointId", "path")`
        );

        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure doc_mount_folders table in mount index database', {
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

    return new SQLiteCollection<DocMountFolder>(db, this.collectionName, jsonColumns, arrayColumns, booleanColumns);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async findById(id: string): Promise<DocMountFolder | null> {
    return this._findById(id);
  }

  async findAll(): Promise<DocMountFolder[]> {
    return this._findAll();
  }

  async create(
    data: Omit<DocMountFolder, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountFolder> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<DocMountFolder>): Promise<DocMountFolder | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find a folder by mount point and relative path.
   * @param mountPointId The mount point ID
   * @param path The relative path ('' for root)
   * @returns Promise<DocMountFolder | null> The folder if found
   */
  async findByMountPointAndPath(
    mountPointId: string,
    path: string
  ): Promise<DocMountFolder | null> {
    return this.safeQuery(
      async () =>
        this.findOneByFilter({
          mountPointId,
          path,
        } as TypedQueryFilter<DocMountFolder>),
      'Error finding folder by mount point and path',
      { mountPointId, path },
      null
    );
  }

  /**
   * Find all child folders for a given parent folder.
   * @param mountPointId The mount point ID
   * @param parentId The parent folder ID (or null for root children)
   * @returns Promise<DocMountFolder[]> Array of child folders
   */
  async findChildren(
    mountPointId: string,
    parentId: string | null
  ): Promise<DocMountFolder[]> {
    return this.safeQuery(
      async () =>
        this.findByFilter({
          mountPointId,
          parentId,
        } as TypedQueryFilter<DocMountFolder>),
      'Error finding child folders',
      { mountPointId, parentId },
      []
    );
  }

  /**
   * Find all folders for a mount point.
   * @param mountPointId The mount point ID
   * @returns Promise<DocMountFolder[]> Array of all folders in the mount point
   */
  async findByMountPointId(mountPointId: string): Promise<DocMountFolder[]> {
    return this.safeQuery(
      async () =>
        this.findByFilter({
          mountPointId,
        } as TypedQueryFilter<DocMountFolder>),
      'Error finding folders by mount point ID',
      { mountPointId },
      []
    );
  }

  /**
   * Delete all folders for a mount point.
   * @param mountPointId The mount point ID
   * @returns Promise<void>
   */
  async deleteByMountPointId(mountPointId: string): Promise<void> {
    return this.safeQuery(
      async () => {
        await this.deleteMany({
          mountPointId,
        } as TypedQueryFilter<DocMountFolder>);
      },
      'Error deleting folders by mount point ID',
      { mountPointId }
    );
  }
}
