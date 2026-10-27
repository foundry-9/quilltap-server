/**
 * Log Entries Repository
 *
 * The instance's ledger: free-text lines written by `log_create_entry` and by
 * a custom tool's `log` effect, read back by `log_grep` and `log_read`.
 * Lives in the dedicated LLM logs database (quilltap-llm-logs.db) via
 * `AbstractDedicatedDbRepository`, and is pruned with the LLM logs
 * (`LLM_LOG_CLEANUP`, the same retention days).
 *
 * Entries are written once and never edited. Every read answers newest first.
 *
 * When the logs DB is in degraded mode, reads answer empty and writes throw,
 * as the other LLM-logs tables do.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '@/lib/logger';
import { LogEntry, LogEntrySchema } from '@/lib/schemas/log-entry.types';
import { CreateOptions } from './base.repository';
import { AbstractDedicatedDbRepository } from './dedicated-db.repository';
import { requireLLMLogsDb } from '../backends/sqlite/llm-logs-guard';
import { REGEXP_FUNCTION_NAME } from '../backends/sqlite/regexp-function';

/** Filters for {@link LogEntriesRepository.findEntries}. Every one is optional and they AND together. */
export interface LogEntryFilter {
  chatId?: string;
  characterId?: string;
  /** Inclusive lower bound, ISO-8601. */
  from?: string;
  /** Inclusive upper bound, ISO-8601. */
  to?: string;
  limit: number;
}

/** Columns every read returns, in schema order. */
const COLUMNS = `"id", "message", "chatId", "characterId", "createdAt", "updatedAt"`;

export class LogEntriesRepository extends AbstractDedicatedDbRepository<LogEntry> {
  constructor() {
    super('log_entries', LogEntrySchema, { dbTarget: 'llmLogs', acquireDb: requireLLMLogsDb });
  }

  protected override onTableEnsured(db: DatabaseType): void {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_log_entries_chatId ON log_entries ("chatId", "createdAt" DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_log_entries_characterId ON log_entries ("characterId", "createdAt" DESC)`);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<LogEntry, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<LogEntry> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<LogEntry>): Promise<LogEntry | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Reads
  // ============================================================================

  /** Entries matching every given filter, newest first, at most `limit`. */
  async findEntries(filter: LogEntryFilter): Promise<LogEntry[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.chatId) {
      clauses.push('"chatId" = ?');
      params.push(filter.chatId);
    }
    if (filter.characterId) {
      clauses.push('"characterId" = ?');
      params.push(filter.characterId);
    }
    if (filter.from) {
      clauses.push('"createdAt" >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      clauses.push('"createdAt" <= ?');
      params.push(filter.to);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    return this.withRawDb(
      [] as LogEntry[],
      (db) => {
        const rows = db
          .prepare(`SELECT ${COLUMNS} FROM log_entries ${where} ORDER BY "createdAt" DESC LIMIT ?`)
          .all(...params, filter.limit) as LogEntry[];
        logger.debug('Log entries read', { filters: clauses.length, returned: rows.length });
        return rows;
      },
      'Error reading log entries',
      { filter }
    );
  }

  /**
   * Entries whose message matches a JavaScript regular expression, newest
   * first, at most `limit`. The pattern must already have been checked with
   * `compileSqlRegexp` — a bad one here is an error, rethrown.
   */
  async searchMessages(pattern: string, flags: string, limit: number): Promise<LogEntry[]> {
    return this.withRawDb(
      [] as LogEntry[],
      (db) => {
        const rows = db
          .prepare(
            `SELECT ${COLUMNS} FROM log_entries
             WHERE ${REGEXP_FUNCTION_NAME}(?, "message", ?)
             ORDER BY "createdAt" DESC LIMIT ?`
          )
          .all(pattern, flags, limit) as LogEntry[];
        logger.debug('Log entries searched', { patternLength: pattern.length, flags, returned: rows.length });
        return rows;
      },
      'Error searching log entries',
      { patternLength: pattern.length, flags },
      'rethrow'
    );
  }

  /**
   * Every entry, oldest first — the backup's read. Answers empty while the
   * logs DB is degraded, so a backup still completes without the Log.
   */
  async findAllEntries(): Promise<LogEntry[]> {
    return this.withRawDb(
      [] as LogEntry[],
      (db) => {
        const rows = db
          .prepare(`SELECT ${COLUMNS} FROM log_entries ORDER BY "createdAt" ASC`)
          .all() as LogEntry[];
        logger.debug('All log entries read', { returned: rows.length });
        return rows;
      },
      'Error reading all log entries'
    );
  }

  // ============================================================================
  // Retention
  // ============================================================================

  /**
   * Delete every entry. Used by replace-mode restore and "delete all my data",
   * whose per-user deletes never reach this instance-wide table. Returns how
   * many went (0 while the logs DB is degraded).
   */
  async deleteAll(): Promise<number> {
    return this.withRawDb(
      0,
      (db) => {
        const result = db.prepare(`DELETE FROM log_entries`).run();
        logger.info('Deleted all log entries', { deletedCount: result.changes });
        return result.changes;
      },
      'Error deleting all log entries'
    );
  }

  /** Delete entries older than `retentionDays`. Returns how many went. */
  async cleanupOldEntries(retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffIso = cutoff.toISOString();

    return this.withRawDb(
      0,
      (db) => {
        const result = db.prepare(`DELETE FROM log_entries WHERE "createdAt" < ?`).run(cutoffIso);
        logger.info('Cleaned up old log entries', { retentionDays, deletedCount: result.changes, cutoffDate: cutoffIso });
        return result.changes;
      },
      'Error cleaning up old log entries',
      { retentionDays }
    );
  }
}
