/**
 * Migration: Split Connection-Profile Usage into Chat and Automatic Ledgers
 *
 * `connection_profiles` carried one undercounting total: `totalTokens` /
 * `totalPromptTokens` / `totalCompletionTokens` / `messageCount`, bumped once
 * per Salon, console or help-chat turn with the *last* request's usage only,
 * never for swipes, and never for background work. Usage is now counted per
 * provider call by `accountLLMCall` (lib/services/usage-accounting.service.ts)
 * into two ledgers — chat and automatic — each with calls, uncached prompt,
 * completion, cache-read and cache-write tokens.
 *
 * This migration, in one transaction on the main database:
 * 1. adds the ten ledger columns to `connection_profiles`;
 * 2. carries the old totals into the chat ledger (they only ever counted
 *    chat turns), `messageCount` as the call count;
 * 3. backfills the automatic ledger from `llm_logs` (a separate database),
 *    from whatever rows retention has kept — automatic calls were never
 *    counted anywhere else, so this is the best record there is;
 * 4. drops the four old columns;
 * 5. adds `chats.totalCacheReadTokens` / `totalCacheWriteTokens`.
 *
 * The backfill splits a logged `promptTokens` the way the accounting does:
 * cache writes are inside it (the plugin contract: every input token except
 * cache reads) — except on Anthropic rows logged before the plugin learned
 * that, where they were left out, so nothing is subtracted there.
 *
 * Old `.qtap` bundles and backups still carrying the four old fields are
 * mapped on the way in by `seedLegacyConnectionProfileFields`.
 *
 * Migration ID: split-profile-usage-counters-v1
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
  openLlmLogsDbIfPresent,
  tableExists,
  columnExists,
} from '../lib/database-utils';

const MIGRATION_ID = 'split-profile-usage-counters-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

const LEDGER_COLUMNS = [
  'chatCallCount',
  'chatPromptTokens',
  'chatCompletionTokens',
  'chatCacheReadTokens',
  'chatCacheWriteTokens',
  'automaticCallCount',
  'automaticPromptTokens',
  'automaticCompletionTokens',
  'automaticCacheReadTokens',
  'automaticCacheWriteTokens',
] as const;

const LEGACY_COLUMNS = ['totalTokens', 'totalPromptTokens', 'totalCompletionTokens', 'messageCount'] as const;

const CHAT_CACHE_COLUMNS = ['totalCacheReadTokens', 'totalCacheWriteTokens'] as const;

/** Mirrors `CHAT_USAGE_LOG_TYPES` (lib/schemas/llm-log.types.ts) at the time of writing. */
const CHAT_LOG_TYPES = ['CHAT_MESSAGE', 'TOOL_CONTINUATION'] as const;

interface AutomaticRow {
  profileId: string;
  calls: number;
  prompt: number;
  completion: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Automatic usage per profile from the LLM logs, or [] when there are none. */
function readAutomaticUsageFromLogs(): AutomaticRow[] {
  let db: DatabaseType | null = null;
  try {
    db = openLlmLogsDbIfPresent();
    if (!db || !tableExists(db, 'llm_logs') || !columnExists(db, 'llm_logs', 'connectionProfileId')) {
      logger.debug('No profile-attributed LLM logs to backfill automatic usage from', { context: LOG_CONTEXT });
      return [];
    }
    const hasCache = columnExists(db, 'llm_logs', 'cacheUsage');
    const write = hasCache ? `COALESCE(json_extract("cacheUsage", '$.cacheCreationInputTokens'), 0)` : '0';
    const read = hasCache ? `COALESCE(json_extract("cacheUsage", '$.cacheReadInputTokens'), 0)` : '0';
    const prompt = `COALESCE(json_extract("usage", '$.promptTokens'), 0)`;
    const placeholders = CHAT_LOG_TYPES.map(() => '?').join(', ');
    return db.prepare(
      `SELECT "connectionProfileId" AS profileId,
              COUNT(*) AS calls,
              SUM(CASE WHEN upper("provider") = 'ANTHROPIC' THEN ${prompt}
                       ELSE MAX(0, ${prompt} - MIN(${write}, ${prompt})) END) AS prompt,
              SUM(COALESCE(json_extract("usage", '$.completionTokens'), 0)) AS completion,
              SUM(${read}) AS cacheRead,
              SUM(CASE WHEN upper("provider") = 'ANTHROPIC' THEN ${write}
                       ELSE MIN(${write}, ${prompt}) END) AS cacheWrite
         FROM "llm_logs"
        WHERE "connectionProfileId" IS NOT NULL
          AND "type" NOT IN (${placeholders})
        GROUP BY "connectionProfileId"`
    ).all(...CHAT_LOG_TYPES) as AutomaticRow[];
  } finally {
    db?.close();
  }
}

export const splitProfileUsageCountersMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Split connection-profile usage into chat and automatic ledgers; add chat cache-token totals',
  introducedInVersion: '4.14.2',
  dependsOn: ['add-profile-tool-result-verbatim-turns-v1', 'add-llm-logs-profile-columns-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    const profiles = sqliteTableExists('connection_profiles')
      && (LEGACY_COLUMNS.some((c) => sqliteColumnExists('connection_profiles', c))
        || LEDGER_COLUMNS.some((c) => !sqliteColumnExists('connection_profiles', c)));
    const chats = sqliteTableExists('chats')
      && CHAT_CACHE_COLUMNS.some((c) => !sqliteColumnExists('chats', c));
    return profiles || chats;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      // Read the logs first: a separate database, outside the transaction.
      const automatic = sqliteTableExists('connection_profiles') ? readAutomaticUsageFromLogs() : [];
      const db = getSQLiteDatabase();
      let profilesTouched = 0;

      db.transaction(() => {
        if (sqliteTableExists('connection_profiles')) {
          for (const column of LEDGER_COLUMNS) {
            if (!sqliteColumnExists('connection_profiles', column)) {
              db.exec(`ALTER TABLE "connection_profiles" ADD COLUMN "${column}" INTEGER DEFAULT 0`);
            }
          }

          const legacyPresent = LEGACY_COLUMNS.filter((c) => sqliteColumnExists('connection_profiles', c));
          if (legacyPresent.length > 0) {
            const col = (name: string) => (legacyPresent.includes(name as (typeof LEGACY_COLUMNS)[number])
              ? `COALESCE("${name}", 0)` : '0');
            profilesTouched = db.prepare(
              `UPDATE "connection_profiles" SET
                 "chatCallCount" = COALESCE("chatCallCount", 0) + ${col('messageCount')},
                 "chatPromptTokens" = COALESCE("chatPromptTokens", 0) + ${col('totalPromptTokens')},
                 "chatCompletionTokens" = COALESCE("chatCompletionTokens", 0) + ${col('totalCompletionTokens')}`
            ).run().changes;
          }

          const addAutomatic = db.prepare(
            `UPDATE "connection_profiles" SET
               "automaticCallCount" = COALESCE("automaticCallCount", 0) + ?,
               "automaticPromptTokens" = COALESCE("automaticPromptTokens", 0) + ?,
               "automaticCompletionTokens" = COALESCE("automaticCompletionTokens", 0) + ?,
               "automaticCacheReadTokens" = COALESCE("automaticCacheReadTokens", 0) + ?,
               "automaticCacheWriteTokens" = COALESCE("automaticCacheWriteTokens", 0) + ?
             WHERE "id" = ?`
          );
          // Only on the run that also drops the legacy columns: a re-run (the
          // columns already gone) must not add the logs a second time.
          if (legacyPresent.length > 0) {
            automatic.forEach((row, i) => {
              addAutomatic.run(row.calls, row.prompt, row.completion, row.cacheRead, row.cacheWrite, row.profileId);
              reportProgress(i + 1, automatic.length, 'profiles');
            });
          }

          for (const column of legacyPresent) {
            db.exec(`ALTER TABLE "connection_profiles" DROP COLUMN "${column}"`);
          }
        }

        if (sqliteTableExists('chats')) {
          for (const column of CHAT_CACHE_COLUMNS) {
            if (!sqliteColumnExists('chats', column)) {
              db.exec(`ALTER TABLE "chats" ADD COLUMN "${column}" INTEGER DEFAULT 0`);
            }
          }
        }
      })();

      logger.info('Split connection-profile usage into chat and automatic ledgers', {
        context: LOG_CONTEXT,
        profilesTouched,
        automaticProfilesBackfilled: automatic.length,
      });
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: profilesTouched,
        message: `Split usage counters on ${profilesTouched} profile(s); automatic usage backfilled for ${automatic.length} from the LLM logs`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to split connection-profile usage counters', { context: LOG_CONTEXT, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to split connection-profile usage counters',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
