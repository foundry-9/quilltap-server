/**
 * Migration: Clear the chat summaries that are really the chat's own scenario
 *
 * Until bug 158, creating a chat wrote the chosen scenario into `contextSummary`
 * as well as `scenarioText` — a leftover from before `add-chat-scenario-text-field-v1`
 * (4.1.0) gave the scenario a column of its own. Every reader of `contextSummary`
 * therefore believed a brand-new chat had already been summarized. The one that
 * hurt was the greeting's "Recent Conversations" block, which inlines the column
 * whole: a prior chat that was opened and never summarized contributed its entire
 * raw scenario to the next greeting's prompt, and the character opened in that
 * room instead of the one the operator chose.
 *
 * The seed is gone. This clears the rows already on disk: `contextSummary` to
 * NULL wherever it is byte-identical to the same row's `scenarioText`.
 *
 * Equality is the whole predicate, deliberately. A real summary is written only
 * by the fold in `lib/chat/context-summary.ts`, which replaces the column
 * outright — so a chat that has been summarized even once no longer matches, and
 * a summary that happens to quote the scenario is not byte-identical to it. Rows
 * where either column is NULL are left alone; so is a chat whose scenario is the
 * empty string, which carries no information either way.
 *
 * Migration ID: clear-scenario-seeded-chat-summaries-v1
 */

import type { Migration, MigrationResult } from '../types';
import type { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

const MIGRATION_ID = 'clear-scenario-seeded-chat-summaries-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

/**
 * The seeded shape: both columns present and the same bytes. Kept as one string
 * so the count and the UPDATE can never disagree about what they are addressing.
 */
const SEEDED_WHERE = `
  "contextSummary" IS NOT NULL
  AND "scenarioText" IS NOT NULL
  AND "scenarioText" <> ''
  AND "contextSummary" = "scenarioText"
`;

function countSeeded(db: DatabaseType): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM "chats" WHERE ${SEEDED_WHERE}`).get() as { n: number };
  return row.n;
}

function chatsTableUsable(): boolean {
  if (!sqliteTableExists('chats')) return false;
  const cols = getSQLiteTableColumns('chats').map((c) => c.name);
  return cols.includes('contextSummary') && cols.includes('scenarioText');
}

export const clearScenarioSeededChatSummariesMigration: Migration = {
  id: MIGRATION_ID,
  description:
    "Clear the contextSummary of chats where it is byte-identical to the chat's own scenarioText, so an unsummarized chat stops presenting its scenario to other chats as a recent conversation (bug 158)",
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1', 'add-chat-scenario-text-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!chatsTableUsable()) return false;
    return countSeeded(getSQLiteDatabase()) > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      const toClear = countSeeded(db);
      logger.debug('Scanning chats for scenario-seeded summaries', {
        context: LOG_CONTEXT,
        chats: toClear,
      });

      let cleared = 0;
      if (toClear > 0) {
        // One synchronous statement: the progress tick lands once the rows are
        // written, which is as fine-grained as a single UPDATE can report.
        const result = db
          .prepare(`UPDATE "chats" SET "contextSummary" = NULL, "updatedAt" = ? WHERE ${SEEDED_WHERE}`)
          .run(new Date().toISOString());
        cleared = result.changes;
        reportProgress(cleared, toClear, 'conversations');
      }

      logger.info('Cleared scenario-seeded chat summaries', {
        context: LOG_CONTEXT,
        cleared,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: cleared,
        message:
          cleared > 0
            ? `Cleared the scenario standing in as a summary on ${cleared} conversation${cleared === 1 ? '' : 's'}`
            : 'No conversation is carrying its scenario as a summary',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to clear scenario-seeded chat summaries', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to clear scenario-seeded chat summaries',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
