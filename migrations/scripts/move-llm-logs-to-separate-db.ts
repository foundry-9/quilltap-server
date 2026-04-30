/**
 * Migration: Move LLM Logs to Separate Database
 *
 * Moves the llm_logs table from the main quilltap.db to a dedicated
 * quilltap-llm-logs.db file. This isolates high-churn debug data so
 * corruption can never threaten characters, chats, messages, or memories.
 *
 * For existing installations:
 * 1. Creates the llm_logs table + indexes in the new DB
 * 2. Copies existing rows in batches of 500
 * 3. Drops the llm_logs table from the main DB
 *
 * For fresh installations:
 * 1. Creates the llm_logs table + indexes in the new DB
 * (main DB never had the table)
 *
 * Migration ID: move-llm-logs-to-separate-db-v1
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import { getDataDir } from '../../lib/paths';

/** Batch size for copying rows */
const BATCH_SIZE = 500;

/** Table DDL for the LLM logs table */
const LLM_LOGS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS "llm_logs" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "messageId" TEXT,
  "chatId" TEXT,
  "characterId" TEXT,
  "provider" TEXT NOT NULL,
  "modelName" TEXT NOT NULL,
  "request" TEXT NOT NULL,
  "response" TEXT NOT NULL,
  "usage" TEXT,
  "cacheUsage" TEXT,
  "requestHashes" TEXT,
  "durationMs" INTEGER,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
)`;

/** Index DDL for the LLM logs table */
const LLM_LOGS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS "idx_llm_logs_userId" ON "llm_logs" ("userId")`,
  `CREATE INDEX IF NOT EXISTS "idx_llm_logs_chatId" ON "llm_logs" ("chatId")`,
  `CREATE INDEX IF NOT EXISTS "idx_llm_logs_createdAt" ON "llm_logs" ("createdAt" DESC)`,
  `CREATE INDEX IF NOT EXISTS "idx_llm_logs_type" ON "llm_logs" ("type")`,
];

/**
 * Get the path to the LLM logs database
 */
function getLLMLogsDbPath(): string {
  return process.env.SQLITE_LLM_LOGS_PATH || path.join(getDataDir(), 'quilltap-llm-logs.db');
}

/**
 * Check if the LLM logs table exists in the separate DB
 */
function llmLogsDbHasTable(logsDbPath: string): boolean {
  if (!fs.existsSync(logsDbPath)) {
    return false;
  }

  try {
    const db = new Database(logsDbPath, { readonly: true });
    // SQLCipher key must be first pragma
    const sqlcipherKey = process.env.ENCRYPTION_MASTER_PEPPER;
    if (sqlcipherKey) {
      const keyHex = Buffer.from(sqlcipherKey, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }
    try {
      const result = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'llm_logs'`
      ).get() as { name: string } | undefined;
      return !!result;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/**
 * Check if migration needs to run
 */
function needsWork(): boolean {
  if (!isSQLiteBackend()) {
    return false;
  }

  const logsDbPath = getLLMLogsDbPath();

  // Needs to run if the separate DB doesn't have the table yet
  if (!llmLogsDbHasTable(logsDbPath)) {
    return true;
  }

  // Also needs to run if the main DB still has the llm_logs table
  if (sqliteTableExists('llm_logs')) {
    return true;
  }

  return false;
}

/**
 * Run the migration
 */
function runMigration(): MigrationResult {
  const startTime = Date.now();
  let itemsAffected = 0;

  try {
    const mainDb = getSQLiteDatabase();
    const logsDbPath = getLLMLogsDbPath();

    // Ensure data directory exists
    const dataDir = path.dirname(logsDbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Open (or create) the LLM logs database
    const logsDb = new Database(logsDbPath);
    // SQLCipher key must be first pragma
    const sqlcipherKeyMig = process.env.ENCRYPTION_MASTER_PEPPER;
    if (sqlcipherKeyMig) {
      const keyHex = Buffer.from(sqlcipherKeyMig, 'base64').toString('hex');
      logsDb.pragma(`key = "x'${keyHex}'"`);
    }
    logsDb.pragma('journal_mode = WAL');
    logsDb.pragma('busy_timeout = 5000');

    try {
      // Step 1: Create the table + indexes in the logs DB
      logsDb.exec(LLM_LOGS_TABLE_DDL);
      for (const indexSql of LLM_LOGS_INDEXES) {
        logsDb.exec(indexSql);
      }
      logger.info('Created llm_logs table in separate database', {
        context: 'migration.move-llm-logs',
        path: logsDbPath,
      });

      // Step 2: Copy rows from main DB (if the table exists there)
      if (sqliteTableExists('llm_logs')) {
        const rowCount = (mainDb.prepare('SELECT COUNT(*) as count FROM llm_logs').get() as { count: number }).count;

        if (rowCount > 0) {
          logger.info('Copying LLM logs from main DB to separate DB', {
            context: 'migration.move-llm-logs',
            rowCount,
          });

          // Prepare insert statement on the logs DB
          const insertStmt = logsDb.prepare(`
            INSERT OR IGNORE INTO "llm_logs"
            ("id", "userId", "type", "messageId", "chatId", "characterId",
             "provider", "modelName", "request", "response", "usage",
             "cacheUsage", "durationMs", "createdAt", "updatedAt")
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          // Copy in batches
          let offset = 0;
          const selectStmt = mainDb.prepare(
            `SELECT * FROM llm_logs ORDER BY rowid LIMIT ? OFFSET ?`
          );

          const insertBatch = logsDb.transaction((rows: Record<string, unknown>[]) => {
            for (const row of rows) {
              insertStmt.run(
                row.id, row.userId, row.type, row.messageId, row.chatId,
                row.characterId, row.provider, row.modelName, row.request,
                row.response, row.usage, row.cacheUsage, row.durationMs,
                row.createdAt, row.updatedAt
              );
            }
          });

          while (offset < rowCount) {
            const rows = selectStmt.all(BATCH_SIZE, offset) as Record<string, unknown>[];
            if (rows.length === 0) break;

            insertBatch(rows);
            itemsAffected += rows.length;
            offset += rows.length;

            if (offset % 5000 === 0 || offset >= rowCount) {
              logger.info('Migration progress', {
                context: 'migration.move-llm-logs',
                copied: offset,
                total: rowCount,
              });
            }
          }

          logger.info('Finished copying LLM logs', {
            context: 'migration.move-llm-logs',
            totalCopied: itemsAffected,
          });
        }

        // Step 3: Drop the table from the main DB
        mainDb.exec('DROP TABLE IF EXISTS "llm_logs"');
        logger.info('Dropped llm_logs table from main database', {
          context: 'migration.move-llm-logs',
        });
      }
    } finally {
      // Checkpoint and close the logs DB
      try {
        logsDb.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // Best-effort
      }
      logsDb.close();
    }

    const durationMs = Date.now() - startTime;

    return {
      id: 'move-llm-logs-to-separate-db-v1',
      success: true,
      itemsAffected,
      message: itemsAffected > 0
        ? `Moved ${itemsAffected} LLM log rows to separate database`
        : 'Created llm_logs table in separate database (no existing data to move)',
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Move LLM logs migration failed', {
      context: 'migration.move-llm-logs',
      error: errorMessage,
    });

    return {
      id: 'move-llm-logs-to-separate-db-v1',
      success: false,
      itemsAffected,
      message: `Migration failed: ${errorMessage}`,
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Move LLM Logs to Separate Database Migration
 */
export const moveLLMLogsToSeparateDbMigration: Migration = {
  id: 'move-llm-logs-to-separate-db-v1',
  description: 'Move llm_logs table from main database to dedicated quilltap-llm-logs.db for isolation',
  introducedInVersion: '3.1.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    return needsWork();
  },

  async run(): Promise<MigrationResult> {
    logger.info('Starting move LLM logs to separate database migration', {
      context: 'migration.move-llm-logs',
    });
    return runMigration();
  },
};
