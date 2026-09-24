/**
 * Abstract Dedicated-Database Repository
 *
 * Base class for repositories whose table lives in one of the dedicated
 * SQLite databases (the mount index or the LLM logs file) rather than the
 * main database. Ten repositories used to carry a private copy of the same
 * `getCollection()` override — acquire the raw connection, run the table's
 * DDL once behind a private flag, classify the schema's JSON / array /
 * boolean columns on every call, build a `SQLiteCollection` — plus some two
 * dozen `const db = getRaw…(); if (!db) return fallback;` preambles in front
 * of raw SQL. This class is that copy, written once.
 *
 * - `getCollection()` acquires the connection through `acquireDb` (which
 *   throws while the database is degraded or uninitialized, so every
 *   `safeQuery` fallback in the subclass kicks in), ensures the table once
 *   per instance, caches the column classification once per instance and
 *   returns a `SQLiteCollection`.
 * - `onTableEnsured(db)` is the hook for a subclass's extra DDL — indexes,
 *   `ALTER TABLE` migrations, case-collision repairs. It runs inside the
 *   same guarded block as the generated DDL, before the table counts as
 *   ensured, so a failure there is logged, rethrown, and retried on the next
 *   access.
 * - `afterTableReady(db)` runs once, after the table counts as ensured. It
 *   exists for work that re-enters this repository (the folder backfill
 *   calls `ensureFolderPath`, which calls back into `getCollection`): with
 *   the flag already set, the re-entrant call gets a working collection
 *   instead of recursing into the hook forever.
 * - `withRawDb(fallback, fn, …)` is the one preamble for raw SQL: it applies
 *   the degraded / uninitialized guard (returning `fallback` quietly, as the
 *   hand-rolled `if (!db) return` sites did), ensures the table, and runs
 *   `fn` inside `safeQuery`.
 * - `ensureRawDb()` is `withRawDb` without the fallback — the connection or
 *   a throw — for writers that must fail loudly when the database is gone.
 *
 * The parent process is the only writer of any of these databases; a forked
 * job child reaches the same repositories through a proxy that buffers the
 * writes by repository key (`lib/background-jobs/host/write-partition.ts`
 * routes them by `dbTarget`). Nothing here changes that contract.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { BaseEntity, DatabaseCollection } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { generateDDL, classifySchemaColumns } from '../schema-translator';
import { AbstractBaseRepository, RepositoryDbTarget } from './base.repository';
import { extractErrorMessage } from './safe-query';

/** The dedicated databases a repository can live in — everything but main. */
export type DedicatedDbTarget = Exclude<RepositoryDbTarget, 'main'>;

/** Human-readable database names for log lines (`… table in mount index database`). */
const DB_LABELS: Record<DedicatedDbTarget, string> = {
  mountIndex: 'mount index',
  llmLogs: 'LLM logs',
};

/** Constructor options for {@link AbstractDedicatedDbRepository}. */
export interface DedicatedDbOptions {
  /** Which dedicated database the table lives in. */
  dbTarget: DedicatedDbTarget;
  /**
   * Hand back the raw connection, or throw when the database is degraded or
   * not initialized (`requireMountIndexDb` / `requireLLMLogsDb`).
   */
  acquireDb: () => DatabaseType;
  /**
   * Columns stored as raw BLOBs (Float32 embedding vectors). Without this the
   * collection would JSON-serialize a `Float32Array` into an index-keyed
   * object that no later read can decode.
   */
  blobColumns?: string[];
  /** Columns stored brotli-compressed (see `lib/database/text-compression.ts`). */
  compressedColumns?: string[];
}

/**
 * How {@link AbstractDedicatedDbRepository.withRawDb} treats an error thrown
 * by the query itself (the guard always answers with the fallback):
 * `'fallback'` logs and returns the fallback, `'rethrow'` logs and rethrows.
 */
export type RawDbFailureMode = 'fallback' | 'rethrow';

type ColumnKinds = ReturnType<typeof classifySchemaColumns>;

export abstract class AbstractDedicatedDbRepository<T extends BaseEntity> extends AbstractBaseRepository<T> {
  override readonly dbTarget: DedicatedDbTarget;
  private readonly acquireDb: () => DatabaseType;
  private readonly blobColumns: string[];
  private readonly compressedColumns: string[];
  private tableEnsured = false;
  private columnKinds: ColumnKinds | null = null;

  constructor(collectionName: string, schema: z.ZodType, options: DedicatedDbOptions) {
    super(collectionName, schema);
    this.dbTarget = options.dbTarget;
    this.acquireDb = options.acquireDb;
    this.blobColumns = options.blobColumns ?? [];
    this.compressedColumns = options.compressedColumns ?? [];
  }

  // ============================================================================
  // Hooks
  // ============================================================================

  /**
   * Extra DDL to run right after the generated `CREATE TABLE` / `CREATE INDEX`
   * statements, once per instance: indexes the schema cannot express, inline
   * `ALTER TABLE` migrations, repair scans. Runs before the table counts as
   * ensured, inside the block whose failure is logged and rethrown.
   */
  protected onTableEnsured(_db: DatabaseType): void {
    // Nothing by default.
  }

  /**
   * Work to run once, after the table counts as ensured. Anything here that
   * calls back into this repository (directly or through another repository)
   * finds a ready collection rather than re-entering the init block.
   */
  protected async afterTableReady(_db: DatabaseType): Promise<void> {
    // Nothing by default.
  }

  // ============================================================================
  // Connection + table
  // ============================================================================

  /**
   * Ensure the table (and the subclass's extras) exist. The flag is set
   * BEFORE `afterTableReady` runs, deliberately — see the class doc.
   */
  private async ensureTable(db: DatabaseType): Promise<void> {
    if (this.tableEnsured) return;

    try {
      const ddlStatements = generateDDL(this.collectionName, this.schema);
      for (const sql of ddlStatements) {
        db.exec(sql);
      }
      this.onTableEnsured(db);
      this.tableEnsured = true;
    } catch (error) {
      logger.error(`Failed to ensure ${this.collectionName} table in ${DB_LABELS[this.dbTarget]} database`, {
        error: extractErrorMessage(error),
      });
      throw error;
    }

    await this.afterTableReady(db);
  }

  /**
   * The raw connection with the table ensured, or a throw when the database
   * is degraded or not initialized. For writers that must not proceed
   * without it; readers with a sensible empty answer use {@link withRawDb}.
   */
  protected async ensureRawDb(): Promise<DatabaseType> {
    const db = this.acquireDb();
    await this.ensureTable(db);
    return db;
  }

  /**
   * The collection, routed to the dedicated database. Throws (through
   * `acquireDb`) while the database is degraded or uninitialized, which is
   * what lets every `safeQuery` fallback in a subclass kick in.
   */
  protected async getCollection(): Promise<DatabaseCollection<T>> {
    const db = await this.ensureRawDb();

    if (!this.columnKinds) {
      this.columnKinds = classifySchemaColumns(this.collectionName, this.schema);
    }
    const { jsonColumns, arrayColumns, booleanColumns } = this.columnKinds;

    return new SQLiteCollection<T>(
      db,
      this.collectionName,
      jsonColumns,
      arrayColumns,
      booleanColumns,
      this.blobColumns,
      this.compressedColumns,
    );
  }

  /**
   * Run raw SQL against the dedicated database.
   *
   * Returns `fallback` — quietly, with a debug line — when the database is
   * degraded or not initialized. Otherwise ensures the table and runs `fn`
   * inside `safeQuery`: a thrown error is logged under `errorMessage` and
   * answered with `fallback` (`'fallback'` mode, the default) or rethrown
   * (`'rethrow'` mode, for callers whose own caller must see the failure).
   */
  protected async withRawDb<R>(
    fallback: R,
    fn: (db: DatabaseType) => R | Promise<R>,
    errorMessage: string,
    context: Record<string, unknown> = {},
    mode: RawDbFailureMode = 'fallback',
  ): Promise<R> {
    let db: DatabaseType;
    try {
      db = this.acquireDb();
    } catch (error) {
      logger.debug('Dedicated database unavailable; answering with the fallback', {
        collection: this.collectionName,
        dbTarget: this.dbTarget,
        error: extractErrorMessage(error),
      });
      return fallback;
    }

    const operation = async (): Promise<R> => {
      await this.ensureTable(db);
      return fn(db);
    };

    if (mode === 'rethrow') {
      return this.safeQuery(operation, errorMessage, context);
    }
    return this.safeQuery(operation, errorMessage, context, fallback);
  }
}
