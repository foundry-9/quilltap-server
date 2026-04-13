/**
 * Document Mount Chunks Repository
 *
 * Backend-agnostic repository for DocMountChunk entities.
 * Overrides getCollection() to route all operations to the dedicated
 * mount index database (quilltap-mount-index.db), isolating document
 * mount tracking data from the main database.
 *
 * Includes BLOB column handling for vector embeddings — the `embedding`
 * column stores Float32 BLOBs that need special deserialization. Since
 * this repository uses a separate database, blob columns are passed
 * directly to the SQLiteCollection constructor rather than using
 * registerBlobColumns (which targets the main database).
 *
 * When the mount index DB is in degraded mode (corruption, permissions, etc.),
 * getCollection() throws and all safeQuery fallbacks kick in — returning
 * empty arrays, null, etc. The rest of the app continues normally.
 */

import { logger } from '@/lib/logger';
import { DocMountChunk, DocMountChunkSchema } from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';
import { generateDDL, extractSchemaMetadata } from '../schema-translator';

/**
 * Document Mount Chunks Repository
 * Implements CRUD operations and queries for document mount chunks
 * with BLOB embedding support. Uses the mount index database.
 */
export class DocMountChunksRepository extends AbstractBaseRepository<DocMountChunk> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('doc_mount_chunks', DocMountChunkSchema);
  }

  /**
   * Override getCollection to return a collection from the dedicated mount index
   * database instead of the main database. Also registers the `embedding` column
   * as a BLOB column so that Float32 BLOBs are properly deserialized to number[].
   */
  protected async getCollection(): Promise<DatabaseCollection<DocMountChunk>> {
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
        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure doc_mount_chunks table in mount index database', {
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

    // Pass 'embedding' as a blob column directly to the SQLiteCollection constructor.
    // This ensures Float32 BLOBs stored in the embedding column are properly
    // deserialized to number[] without going through registerBlobColumns (which
    // targets the main database's collection registry).
    const blobColumns = ['embedding'];

    return new SQLiteCollection<DocMountChunk>(
      db, this.collectionName, jsonColumns, arrayColumns, booleanColumns, blobColumns
    );
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async findById(id: string): Promise<DocMountChunk | null> {
    return this._findById(id);
  }

  async findAll(): Promise<DocMountChunk[]> {
    return this._findAll();
  }

  async create(
    data: Omit<DocMountChunk, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountChunk> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<DocMountChunk>): Promise<DocMountChunk | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find all chunks for a file
   * @param fileId The file ID
   * @returns Promise<DocMountChunk[]> Array of chunks for the file
   */
  async findByFileId(fileId: string): Promise<DocMountChunk[]> {
    return this.safeQuery(
      async () => {
        logger.debug('Finding chunks by file ID', {
          context: 'DocMountChunksRepository.findByFileId',
          fileId,
        });
        const results = await this.findByFilter(
          { fileId } as TypedQueryFilter<DocMountChunk>,
          { sort: { chunkIndex: 1 } }
        );
        logger.debug('Found chunks by file ID', {
          context: 'DocMountChunksRepository.findByFileId',
          fileId,
          count: results.length,
        });
        return results;
      },
      'Error finding chunks by file ID',
      { fileId },
      []
    );
  }

  /**
   * Find all chunks for a mount point
   * @param mountPointId The mount point ID
   * @returns Promise<DocMountChunk[]> Array of chunks for the mount point
   */
  async findByMountPointId(mountPointId: string): Promise<DocMountChunk[]> {
    return this.safeQuery(
      async () => {
        logger.debug('Finding chunks by mount point ID', {
          context: 'DocMountChunksRepository.findByMountPointId',
          mountPointId,
        });
        const results = await this.findByFilter(
          { mountPointId } as TypedQueryFilter<DocMountChunk>
        );
        logger.debug('Found chunks by mount point ID', {
          context: 'DocMountChunksRepository.findByMountPointId',
          mountPointId,
          count: results.length,
        });
        return results;
      },
      'Error finding chunks by mount point ID',
      { mountPointId },
      []
    );
  }

  /**
   * Find all chunks with non-null embeddings for a set of mount point IDs.
   * Loads chunks per mount point and filters for non-null embeddings.
   *
   * @param mountPointIds Array of mount point IDs to query
   * @returns Promise<DocMountChunk[]> Array of chunks with embeddings
   */
  async findAllWithEmbeddingsByMountPointIds(mountPointIds: string[]): Promise<DocMountChunk[]> {
    return this.safeQuery(
      async () => {
        if (mountPointIds.length === 0) {
          return [];
        }

        logger.debug('Finding chunks with embeddings for mount point IDs', {
          context: 'DocMountChunksRepository.findAllWithEmbeddingsByMountPointIds',
          mountPointIdCount: mountPointIds.length,
        });

        const allChunks: DocMountChunk[] = [];
        for (const mountPointId of mountPointIds) {
          const chunks = await this.findByFilter(
            { mountPointId } as TypedQueryFilter<DocMountChunk>
          );
          allChunks.push(...chunks);
        }

        // Filter for non-null embeddings
        const withEmbeddings = allChunks.filter(
          chunk => chunk.embedding != null && Array.isArray(chunk.embedding) && chunk.embedding.length > 0
        );

        logger.debug('Found chunks with embeddings for mount point IDs', {
          context: 'DocMountChunksRepository.findAllWithEmbeddingsByMountPointIds',
          totalChunks: allChunks.length,
          withEmbeddings: withEmbeddings.length,
        });

        return withEmbeddings;
      },
      'Error finding chunks with embeddings by mount point IDs',
      { mountPointIdCount: mountPointIds.length },
      []
    );
  }

  /**
   * Delete all chunks for a file
   * @param fileId The file ID
   * @returns Promise<number> Number of chunks deleted
   */
  async deleteByFileId(fileId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        logger.debug('Deleting chunks by file ID', {
          context: 'DocMountChunksRepository.deleteByFileId',
          fileId,
        });
        const count = await this.deleteMany(
          { fileId } as TypedQueryFilter<DocMountChunk>
        );
        logger.debug('Deleted chunks by file ID', {
          context: 'DocMountChunksRepository.deleteByFileId',
          fileId,
          deletedCount: count,
        });
        return count;
      },
      'Error deleting chunks by file ID',
      { fileId }
    );
  }

  /**
   * Delete all chunks for a mount point
   * @param mountPointId The mount point ID
   * @returns Promise<number> Number of chunks deleted
   */
  async deleteByMountPointId(mountPointId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        logger.debug('Deleting chunks by mount point ID', {
          context: 'DocMountChunksRepository.deleteByMountPointId',
          mountPointId,
        });
        const count = await this.deleteMany(
          { mountPointId } as TypedQueryFilter<DocMountChunk>
        );
        logger.debug('Deleted chunks by mount point ID', {
          context: 'DocMountChunksRepository.deleteByMountPointId',
          mountPointId,
          deletedCount: count,
        });
        return count;
      },
      'Error deleting chunks by mount point ID',
      { mountPointId }
    );
  }

  /**
   * Update the embedding vector for a chunk
   * @param id The chunk ID
   * @param embedding The new embedding vector (Float32 array)
   */
  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.safeQuery(
      async () => {
        const updated = await this._update(id, {
          embedding,
        } as Partial<DocMountChunk>);

        if (!updated) {
          throw new Error(`Doc mount chunk not found for embedding update: ${id}`);
        }

        logger.debug('Updated embedding for doc mount chunk', {
          context: 'DocMountChunksRepository.updateEmbedding',
          id,
          embeddingLength: embedding.length,
        });
      },
      'Error updating doc mount chunk embedding',
      { id }
    );
  }

  /**
   * Bulk insert multiple chunks.
   * Iterates and calls _create for each chunk since the ORM does not
   * support native bulk insert.
   *
   * @param chunks Array of chunk data (without id, createdAt, updatedAt)
   * @returns Promise<DocMountChunk[]> Array of created chunks
   */
  async bulkInsert(
    chunks: Array<Omit<DocMountChunk, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<DocMountChunk[]> {
    return this.safeQuery(
      async () => {
        logger.debug('Bulk inserting doc mount chunks', {
          context: 'DocMountChunksRepository.bulkInsert',
          count: chunks.length,
        });

        const created: DocMountChunk[] = [];
        for (const chunk of chunks) {
          const result = await this._create(chunk);
          created.push(result);
        }

        logger.debug('Bulk insert complete for doc mount chunks', {
          context: 'DocMountChunksRepository.bulkInsert',
          insertedCount: created.length,
        });

        return created;
      },
      'Error bulk inserting doc mount chunks',
      { count: chunks.length }
    );
  }
}
