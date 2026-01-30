/**
 * SQLite Database Backend
 *
 * Implements the DatabaseBackend interface for SQLite using better-sqlite3.
 * Provides collection abstraction over SQLite tables with JSON column support.
 */

import { z } from 'zod';
import { Database as DatabaseType, Statement } from 'better-sqlite3';
import {
  DatabaseBackend,
  DatabaseCollection,
  DatabaseTransaction,
  ConnectionState,
  QueryFilter,
  QueryOptions,
  UpdateSpec,
  InsertResult,
  UpdateResult,
  DeleteResult,
  SQLITE_CAPABILITIES,
} from '../../interfaces';
import { SQLiteConfig, loadSQLiteConfig } from '../../config';
import { getSQLiteClient, closeSQLiteClient, isSQLiteConnected, setupSQLiteShutdownHandlers } from './client';
import { generateDDL, extractSchemaMetadata } from '../../schema-translator';
import { buildSelectQuery, buildCountQuery, buildUpdateQuery, buildDeleteQuery, translateFilter } from './query-translator';
import { documentToRow, rowToDocument, toJson, fromJson } from './json-columns';
import { logger } from '@/lib/logger';

// ============================================================================
// SQLite Collection Implementation
// ============================================================================

/**
 * SQLite implementation of DatabaseCollection
 */
class SQLiteCollection<T = unknown> implements DatabaseCollection<T> {
  readonly name: string;
  private db: DatabaseType;
  private jsonColumns: Set<string>;
  private arrayColumns: Set<string>;
  private booleanColumns: Set<string>;
  private preparedStatements: Map<string, Statement> = new Map();

  constructor(db: DatabaseType, name: string, jsonColumns: string[] = [], arrayColumns: string[] = [], booleanColumns: string[] = []) {
    this.db = db;
    this.name = name;
    this.jsonColumns = new Set(jsonColumns);
    this.arrayColumns = new Set(arrayColumns);
    this.booleanColumns = new Set(booleanColumns);
  }

  /**
   * Get or create a prepared statement
   */
  private getStatement(key: string, sql: string): Statement {
    if (!this.preparedStatements.has(key)) {
      this.preparedStatements.set(key, this.db.prepare(sql));
    }
    return this.preparedStatements.get(key)!;
  }

  /**
   * Find a single document
   */
  async findOne(filter: QueryFilter, options?: QueryOptions): Promise<T | null> {
    try {
      const query = buildSelectQuery(this.name, filter, { ...options, limit: 1 }, this.jsonColumns, this.arrayColumns);
      const row = this.db.prepare(query.sql).get(...query.params) as Record<string, unknown> | undefined;

      if (!row) {
        return null;
      }

      return this.hydrateRow(row);
    } catch (error) {
      logger.error('SQLite findOne error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find multiple documents
   */
  async find(filter: QueryFilter, options?: QueryOptions): Promise<T[]> {
    try {
      const query = buildSelectQuery(this.name, filter, options, this.jsonColumns, this.arrayColumns);
      const rows = this.db.prepare(query.sql).all(...query.params) as Record<string, unknown>[];

      return rows.map(row => this.hydrateRow(row));
    } catch (error) {
      logger.error('SQLite find error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Insert a single document
   */
  async insertOne(document: T): Promise<InsertResult> {
    try {
      const doc = document as Record<string, unknown>;
      const row = documentToRow(doc, Array.from(this.jsonColumns));

      const columns = Object.keys(row);
      const placeholders = columns.map(() => '?').join(', ');
      const values = Object.values(row);

      const sql = `INSERT INTO "${this.name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
      const result = this.db.prepare(sql).run(...values);

      return {
        insertedId: doc.id as string,
        acknowledged: result.changes > 0,
      };
    } catch (error) {
      logger.error('SQLite insertOne error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Insert multiple documents
   */
  async insertMany(documents: T[]): Promise<{ insertedIds: string[]; acknowledged: boolean }> {
    if (documents.length === 0) {
      return { insertedIds: [], acknowledged: true };
    }

    try {
      const insertedIds: string[] = [];
      const firstDoc = documents[0] as Record<string, unknown>;
      const columns = Object.keys(documentToRow(firstDoc, Array.from(this.jsonColumns)));
      const placeholders = columns.map(() => '?').join(', ');

      const sql = `INSERT INTO "${this.name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
      const stmt = this.db.prepare(sql);

      const insertAll = this.db.transaction((docs: T[]) => {
        for (const document of docs) {
          const doc = document as Record<string, unknown>;
          const row = documentToRow(doc, Array.from(this.jsonColumns));
          stmt.run(...Object.values(row));
          insertedIds.push(doc.id as string);
        }
      });

      insertAll(documents);
      return { insertedIds, acknowledged: true };
    } catch (error) {
      logger.error('SQLite insertMany error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a single document
   */
  async updateOne(filter: QueryFilter, update: UpdateSpec<T>): Promise<UpdateResult> {
    try {
      // First, check if document exists
      const existing = await this.findOne(filter);
      if (!existing) {
        return { matchedCount: 0, modifiedCount: 0, acknowledged: true };
      }

      const query = buildUpdateQuery(this.name, filter, update as UpdateSpec<unknown>, this.jsonColumns, this.arrayColumns);
      const result = this.db.prepare(query.sql).run(...query.params);

      return {
        matchedCount: result.changes > 0 ? 1 : 0,
        modifiedCount: result.changes,
        acknowledged: true,
      };
    } catch (error) {
      logger.error('SQLite updateOne error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update multiple documents
   */
  async updateMany(filter: QueryFilter, update: UpdateSpec<T>): Promise<UpdateResult> {
    try {
      const query = buildUpdateQuery(this.name, filter, update as UpdateSpec<unknown>, this.jsonColumns, this.arrayColumns);
      const result = this.db.prepare(query.sql).run(...query.params);

      return {
        matchedCount: result.changes,
        modifiedCount: result.changes,
        acknowledged: true,
      };
    } catch (error) {
      logger.error('SQLite updateMany error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find and update a document, returning the result
   */
  async findOneAndUpdate(
    filter: QueryFilter,
    update: UpdateSpec<T>,
    options?: { returnDocument?: 'before' | 'after'; upsert?: boolean }
  ): Promise<T | null> {
    try {
      const returnAfter = options?.returnDocument !== 'before';

      // Get the document before update if needed
      const before = returnAfter ? null : await this.findOne(filter);

      // Perform the update
      const updateQuery = buildUpdateQuery(this.name, filter, update as UpdateSpec<unknown>, this.jsonColumns, this.arrayColumns);
      const result = this.db.prepare(updateQuery.sql).run(...updateQuery.params);

      if (result.changes === 0 && options?.upsert) {
        // Document doesn't exist and upsert is requested
        // This is a simplified implementation - full upsert would need more logic
        logger.warn('Upsert not fully implemented for findOneAndUpdate');
        return null;
      }

      if (result.changes === 0) {
        return null;
      }

      // Return the appropriate document
      if (returnAfter) {
        return await this.findOne(filter);
      }

      return before;
    } catch (error) {
      logger.error('SQLite findOneAndUpdate error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a single document
   */
  async deleteOne(filter: QueryFilter): Promise<DeleteResult> {
    try {
      // First find the document to ensure we only delete one
      const existing = await this.findOne(filter);
      if (!existing) {
        return { deletedCount: 0, acknowledged: true };
      }

      // Delete by the document's ID
      const doc = existing as Record<string, unknown>;
      const sql = `DELETE FROM "${this.name}" WHERE "id" = ?`;
      const result = this.db.prepare(sql).run(doc.id);
      return {
        deletedCount: result.changes,
        acknowledged: true,
      };
    } catch (error) {
      logger.error('SQLite deleteOne error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete multiple documents
   */
  async deleteMany(filter: QueryFilter): Promise<DeleteResult> {
    try {
      const query = buildDeleteQuery(this.name, filter, this.jsonColumns, this.arrayColumns);
      const result = this.db.prepare(query.sql).run(...query.params);

      return {
        deletedCount: result.changes,
        acknowledged: true,
      };
    } catch (error) {
      logger.error('SQLite deleteMany error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Count documents matching filter
   */
  async countDocuments(filter?: QueryFilter): Promise<number> {
    try {
      const query = buildCountQuery(this.name, filter || {}, this.jsonColumns, this.arrayColumns);

      const result = this.db.prepare(query.sql).get(...query.params) as { count: number };

      return result.count;
    } catch (error) {
      logger.error('SQLite countDocuments error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if any documents match filter
   */
  async exists(filter: QueryFilter): Promise<boolean> {
    const count = await this.countDocuments(filter);
    return count > 0;
  }

  /**
   * Hydrate a row from SQLite to a document
   * Converts:
   * - JSON columns (stored as strings) back to objects/arrays
   * - Integer booleans (0/1) back to true/false
   * - null JSON objects to undefined (Zod .optional() expects undefined, not null)
   * - null booleans to undefined (for .optional() boolean fields)
   */
  private hydrateRow(row: Record<string, unknown>): T {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      // Skip MongoDB _id field if somehow present
      if (key === '_id') continue;

      // Check if this is a boolean column (from schema metadata or naming convention)
      const isBoolean = this.booleanColumns.has(key) ||
        key.startsWith('is') ||
        key === 'enabled' ||
        key === 'active' ||
        key === 'npc';  // Known boolean field

      // Parse JSON columns - null JSON values become undefined for Zod .optional() compatibility
      if (this.jsonColumns.has(key)) {
        if (value === null) {
          result[key] = undefined;  // null JSON object → undefined for .optional() schemas
        } else if (typeof value === 'string') {
          result[key] = fromJson(value);
        } else {
          result[key] = value;  // Already parsed (shouldn't happen, but handle gracefully)
        }
      } else if (isBoolean) {
        // Handle boolean columns - SQLite stores as INTEGER (0/1) or NULL
        if (value === null) {
          result[key] = undefined;  // null boolean → undefined for .optional() schemas
        } else if (typeof value === 'number') {
          result[key] = value === 1;
        } else {
          result[key] = Boolean(value);  // Fallback conversion
        }
      } else if (typeof value === 'number') {
        result[key] = value;
      } else {
        // Keep null as null for .nullable() fields, pass through other values
        result[key] = value;
      }
    }

    return result as T;
  }

  /**
   * Add a JSON column to the set
   */
  addJsonColumn(column: string): void {
    this.jsonColumns.add(column);
  }
}

// ============================================================================
// SQLite Backend Implementation
// ============================================================================

/**
 * SQLite Database Backend implementation
 */
export class SQLiteBackend implements DatabaseBackend {
  readonly type = 'sqlite' as const;
  readonly capabilities = SQLITE_CAPABILITIES;

  private config: SQLiteConfig;
  private db: DatabaseType | null = null;
  private _state: ConnectionState = 'disconnected';
  private collectionSchemas: Map<string, z.ZodType> = new Map();
  private collectionJsonColumns: Map<string, string[]> = new Map();
  private collectionArrayColumns: Map<string, string[]> = new Map();
  private collectionBooleanColumns: Map<string, string[]> = new Map();

  constructor(config?: SQLiteConfig) {
    this.config = config || loadSQLiteConfig();
  }

  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    if (this._state === 'connected' && this.db) {
      return;
    }

    this._state = 'connecting';

    try {
      this.db = getSQLiteClient(this.config);
      this._state = 'connected';

      setupSQLiteShutdownHandlers();

      logger.info('SQLite backend connected', { path: this.config.path });
    } catch (error) {
      this._state = 'error';
      logger.error('Failed to connect SQLite backend', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    try {
      closeSQLiteClient();
      this.db = null;
      this._state = 'disconnected';

      logger.info('SQLite backend disconnected');
    } catch (error) {
      logger.error('Error disconnecting SQLite backend', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if connected
   */
  async isConnected(): Promise<boolean> {
    return this._state === 'connected' && isSQLiteConnected();
  }

  /**
   * Get a collection by name
   */
  getCollection<T = unknown>(name: string): DatabaseCollection<T> {
    if (!this.db) {
      throw new Error('SQLite backend not connected');
    }

    const jsonColumns = this.collectionJsonColumns.get(name) || [];
    const arrayColumns = this.collectionArrayColumns.get(name) || [];
    const booleanColumns = this.collectionBooleanColumns.get(name) || [];
    return new SQLiteCollection<T>(this.db, name, jsonColumns, arrayColumns, booleanColumns);
  }

  /**
   * Ensure a collection (table) exists with the specified schema
   */
  async ensureCollection(name: string, schema: z.ZodType): Promise<void> {
    if (!this.db) {
      throw new Error('SQLite backend not connected');
    }

    try {
      // Store the schema for later use
      this.collectionSchemas.set(name, schema);

      // Generate DDL from schema
      const ddlStatements = generateDDL(name, schema);

      // Execute DDL
      for (const sql of ddlStatements) {
        this.db.exec(sql);
      }

      // Detect JSON, array, and boolean columns from schema
      const metadata = extractSchemaMetadata(name, schema);
      const jsonColumns = metadata.fields
        .filter(f => f.type === 'array' || f.type === 'object')
        .map(f => f.name);
      const arrayColumns = metadata.fields
        .filter(f => f.type === 'array')
        .map(f => f.name);
      const booleanColumns = metadata.fields
        .filter(f => f.type === 'boolean')
        .map(f => f.name);

      this.collectionJsonColumns.set(name, jsonColumns);
      this.collectionArrayColumns.set(name, arrayColumns);
      this.collectionBooleanColumns.set(name, booleanColumns);
    } catch (error) {
      logger.error('Failed to ensure collection', {
        table: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Drop a collection (table)
   */
  async dropCollection(name: string): Promise<void> {
    if (!this.db) {
      throw new Error('SQLite backend not connected');
    }

    try {
      this.db.exec(`DROP TABLE IF EXISTS "${name}"`);
      this.collectionSchemas.delete(name);
      this.collectionJsonColumns.delete(name);
      this.collectionArrayColumns.delete(name);
      this.collectionBooleanColumns.delete(name);

      logger.info('Dropped collection', { table: name });
    } catch (error) {
      logger.error('Failed to drop collection', {
        table: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List all collections (tables)
   */
  async listCollections(): Promise<string[]> {
    if (!this.db) {
      throw new Error('SQLite backend not connected');
    }

    try {
      const result = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];

      return result.map(r => r.name);
    } catch (error) {
      logger.error('Failed to list collections', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute a raw SQL query
   */
  async rawQuery<R = unknown>(query: string, params: unknown[] = []): Promise<R> {
    if (!this.db) {
      throw new Error('SQLite backend not connected');
    }

    try {
      // Determine if this is a SELECT or modifying statement
      const trimmed = query.trim().toUpperCase();
      if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA')) {
        return this.db.prepare(query).all(...params) as R;
      } else {
        return this.db.prepare(query).run(...params) as R;
      }
    } catch (error) {
      logger.error('Raw query failed', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Begin a transaction
   */
  async beginTransaction(): Promise<DatabaseTransaction> {
    if (!this.db) {
      throw new Error('SQLite backend not connected');
    }

    // SQLite transactions in better-sqlite3 are handled via the transaction() method
    // For the interface compliance, we provide a wrapper
    return new SQLiteTransaction(this.db, this.collectionJsonColumns, this.collectionBooleanColumns);
  }

  /**
   * Run a health check
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; message?: string }> {
    const startTime = Date.now();

    try {
      if (!this.db) {
        return {
          healthy: false,
          latencyMs: Date.now() - startTime,
          message: 'Database not connected',
        };
      }

      // Simple query to verify connection
      this.db.prepare('SELECT 1').get();

      return {
        healthy: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================================
// SQLite Transaction Implementation
// ============================================================================

/**
 * SQLite Transaction wrapper
 */
class SQLiteTransaction implements DatabaseTransaction {
  private db: DatabaseType;
  private committed = false;
  private rolledBack = false;
  private jsonColumns: Map<string, string[]>;
  private booleanColumns: Map<string, string[]>;

  constructor(db: DatabaseType, jsonColumns: Map<string, string[]>, booleanColumns: Map<string, string[]>) {
    this.db = db;
    this.jsonColumns = jsonColumns;
    this.booleanColumns = booleanColumns;
    // Start the transaction
    this.db.exec('BEGIN IMMEDIATE');
  }

  async commit(): Promise<void> {
    if (this.committed || this.rolledBack) {
      throw new Error('Transaction already ended');
    }
    this.db.exec('COMMIT');
    this.committed = true;
  }

  async rollback(): Promise<void> {
    if (this.committed || this.rolledBack) {
      throw new Error('Transaction already ended');
    }
    this.db.exec('ROLLBACK');
    this.rolledBack = true;
  }

  getCollection<T = unknown>(name: string): DatabaseCollection<T> {
    const jsonCols = this.jsonColumns.get(name) || [];
    const boolCols = this.booleanColumns.get(name) || [];
    return new SQLiteCollection<T>(this.db, name, jsonCols, boolCols);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new SQLite backend instance
 */
export async function createSQLiteBackend(config?: SQLiteConfig): Promise<SQLiteBackend> {
  const backend = new SQLiteBackend(config);
  await backend.connect();
  return backend;
}
