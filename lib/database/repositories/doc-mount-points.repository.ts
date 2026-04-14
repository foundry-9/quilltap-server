/**
 * Document Mount Points Repository
 *
 * Backend-agnostic repository for DocMountPoint entities.
 * Overrides getCollection() to route all operations to the dedicated
 * mount index database (quilltap-mount-index.db), isolating document
 * mount tracking data from the main database.
 *
 * When the mount index DB is in degraded mode (corruption, permissions, etc.),
 * getCollection() throws and all safeQuery fallbacks kick in — returning
 * empty arrays, null, etc. The rest of the app continues normally.
 */

import { logger } from '@/lib/logger';
import { DocMountPoint, DocMountPointSchema } from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';
import { generateDDL, extractSchemaMetadata } from '../schema-translator';

/**
 * Document Mount Points Repository
 * Implements CRUD operations and queries for document mount points.
 * Uses the mount index database instead of the main database.
 */
export class DocMountPointsRepository extends AbstractBaseRepository<DocMountPoint> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('doc_mount_points', DocMountPointSchema);
  }

  /**
   * Override getCollection to return a collection from the dedicated mount index
   * database instead of the main database.
   */
  protected async getCollection(): Promise<DatabaseCollection<DocMountPoint>> {
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

        // Migration: add totalSizeBytes column if missing (added after initial schema)
        const columns = db.pragma(`table_info(${this.collectionName})`) as Array<{ name: string }>;
        if (!columns.some(c => c.name === 'totalSizeBytes')) {
          db.exec(`ALTER TABLE "${this.collectionName}" ADD COLUMN "totalSizeBytes" INTEGER NOT NULL DEFAULT 0`);
          logger.info('Migrated doc_mount_points: added totalSizeBytes column');
        }

        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure doc_mount_points table in mount index database', {
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

    return new SQLiteCollection<DocMountPoint>(db, this.collectionName, jsonColumns, arrayColumns, booleanColumns);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async findById(id: string): Promise<DocMountPoint | null> {
    return this._findById(id);
  }

  async findAll(): Promise<DocMountPoint[]> {
    return this._findAll();
  }

  async create(
    data: Omit<DocMountPoint, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountPoint> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<DocMountPoint>): Promise<DocMountPoint | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find all enabled mount points
   * @returns Promise<DocMountPoint[]> Array of enabled mount points
   */
  async findEnabled(): Promise<DocMountPoint[]> {
    return this.safeQuery(
      async () => {
        logger.debug('Finding enabled mount points', {
          context: 'DocMountPointsRepository.findEnabled',
        });
        const results = await this.findByFilter(
          { enabled: true } as TypedQueryFilter<DocMountPoint>
        );
        logger.debug('Found enabled mount points', {
          context: 'DocMountPointsRepository.findEnabled',
          count: results.length,
        });
        return results;
      },
      'Error finding enabled mount points',
      {},
      []
    );
  }

  /**
   * Update scan results after a successful scan
   * @param id The mount point ID
   * @param fileCount Number of active files found
   * @param chunkCount Number of chunks generated
   * @param totalSizeBytes Total size of all files in bytes
   */
  async updateLastScanned(id: string, fileCount: number, chunkCount: number, totalSizeBytes: number): Promise<void> {
    await this.safeQuery(
      async () => {
        logger.debug('Updating last scanned for mount point', {
          context: 'DocMountPointsRepository.updateLastScanned',
          id,
          fileCount,
          chunkCount,
          totalSizeBytes,
        });
        const updated = await this._update(id, {
          lastScannedAt: this.getCurrentTimestamp(),
          scanStatus: 'idle',
          fileCount,
          chunkCount,
          totalSizeBytes,
        } as Partial<DocMountPoint>);

        if (!updated) {
          throw new Error(`Mount point not found for scan update: ${id}`);
        }

        logger.debug('Updated last scanned for mount point', {
          context: 'DocMountPointsRepository.updateLastScanned',
          id,
          fileCount,
          chunkCount,
          totalSizeBytes,
        });
      },
      'Error updating last scanned for mount point',
      { id, fileCount, chunkCount, totalSizeBytes }
    );
  }

  /**
   * Update the scan status of a mount point
   * @param id The mount point ID
   * @param status The new scan status
   * @param error Optional error message when status is 'error'
   */
  async updateScanStatus(
    id: string,
    status: 'idle' | 'scanning' | 'error',
    error?: string
  ): Promise<void> {
    await this.safeQuery(
      async () => {
        logger.debug('Updating scan status for mount point', {
          context: 'DocMountPointsRepository.updateScanStatus',
          id,
          status,
          error,
        });

        const updateData: Partial<DocMountPoint> = {
          scanStatus: status,
        };
        if (status === 'error' && error) {
          updateData.lastScanError = error;
        } else if (status !== 'error') {
          updateData.lastScanError = null;
        }

        const updated = await this._update(id, updateData);

        if (!updated) {
          throw new Error(`Mount point not found for status update: ${id}`);
        }

        logger.debug('Updated scan status for mount point', {
          context: 'DocMountPointsRepository.updateScanStatus',
          id,
          status,
        });
      },
      'Error updating scan status for mount point',
      { id, status }
    );
  }
}
