/**
 * Migration: Add the Chat Concierge Mode Columns
 *
 * Concierge overhaul phase 3 collapses the four per-chat states (Monitored,
 * Flagged, Vouched Safe, Uncensored) into three — Moderated, Unmoderated,
 * Locked — with who-set-it recorded as provenance. Adds three columns to
 * chats:
 * - conciergeMode (TEXT, default 'moderated') — 'moderated' | 'unmoderated' | 'locked'
 * - conciergeModeSetBy (TEXT, default NULL) — 'operator' | 'concierge'
 * - conciergeModeReason (TEXT, default NULL) — 'manual' | 'refusals' | 'classifier' | 'migration'
 *
 * then backfills every chat from the legacy pair with the table in
 * `deriveConciergeModeFromLegacy` (`lib/services/dangerous-content/chat-override.ts`):
 *
 *   conciergeOverride 'UNCENSORED'        → unmoderated, operator, migration
 *   conciergeOverride 'OFF'               → locked, operator, migration
 *   NULL override, isDangerousChat true   → unmoderated, concierge, classifier
 *   otherwise                             → moderated, NULL, NULL
 *
 * `conciergeOverride` is left exactly as it was; it is simply no longer
 * written. Only rows that have not yet been given a provenance are touched,
 * so a re-run changes nothing.
 *
 * Migration ID: add-chat-concierge-mode-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
  querySQLite,
  executeSQLite,
} from '../lib/database-utils';
import { deriveConciergeModeFromLegacy } from '../../lib/services/dangerous-content/chat-override';

const MIGRATION_ID = 'add-chat-concierge-mode-v1';

interface LegacyRow {
  id: string;
  conciergeOverride: string | null;
  isDangerousChat: number | null;
}

/**
 * The WHERE clause (without provenance) matching rows the legacy pair would
 * move off Moderated, built from whichever legacy columns exist. Empty when
 * neither does.
 */
function legacyRowFilter(): string {
  return [
    sqliteColumnExists('chats', 'conciergeOverride') ? `"conciergeOverride" IN ('OFF', 'UNCENSORED')` : null,
    sqliteColumnExists('chats', 'isDangerousChat') ? `"isDangerousChat" = 1` : null,
  ].filter(Boolean).join(' OR ');
}

export const addChatConciergeModeMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add conciergeMode / conciergeModeSetBy / conciergeModeReason to chats and backfill them from the legacy Concierge pair',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-chat-refusal-ledger-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    if (
      !sqliteColumnExists('chats', 'conciergeMode') ||
      !sqliteColumnExists('chats', 'conciergeModeSetBy') ||
      !sqliteColumnExists('chats', 'conciergeModeReason')
    ) {
      return true;
    }

    // The columns are there; a run that died between adding them and the
    // backfill leaves legacy rows still to place.
    const filter = legacyRowFilter();
    if (!filter) return false;
    const [{ n }] = querySQLite<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "chats" WHERE "conciergeModeSetBy" IS NULL AND (${filter})`,
    );
    return n > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;
    let rowsBackfilled = 0;

    try {
      if (addColumnIfMissing('chats', 'conciergeMode', "TEXT DEFAULT 'moderated'")) {
        columnsAdded++;
      }
      if (addColumnIfMissing('chats', 'conciergeModeSetBy', 'TEXT DEFAULT NULL')) {
        columnsAdded++;
      }
      if (addColumnIfMissing('chats', 'conciergeModeReason', 'TEXT DEFAULT NULL')) {
        columnsAdded++;
      }

      // Only a chat the legacy pair would move off Moderated needs a write, and
      // only one that has no provenance yet — a row this migration (or the app)
      // has already placed is left alone.
      const hasOverride = sqliteColumnExists('chats', 'conciergeOverride');
      const hasLabel = sqliteColumnExists('chats', 'isDangerousChat');
      const legacyFilter = legacyRowFilter();

      const rows: LegacyRow[] = legacyFilter
        ? querySQLite<LegacyRow>(
            `SELECT "id", ${hasOverride ? '"conciergeOverride"' : 'NULL AS "conciergeOverride"'}, ` +
            `${hasLabel ? '"isDangerousChat"' : 'NULL AS "isDangerousChat"'} ` +
            `FROM "chats" WHERE "conciergeModeSetBy" IS NULL AND (${legacyFilter})`,
          )
        : [];

      logger.debug('Backfilling Concierge mode from the legacy pair', {
        context: 'migration.add-chat-concierge-mode',
        candidates: rows.length,
      });

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const derived = deriveConciergeModeFromLegacy({
          conciergeOverride: row.conciergeOverride,
          isDangerousChat: row.isDangerousChat === 1,
        });
        if (derived.conciergeMode !== 'moderated') {
          executeSQLite(
            `UPDATE "chats" SET "conciergeMode" = ?, "conciergeModeSetBy" = ?, "conciergeModeReason" = ? WHERE "id" = ?`,
            [derived.conciergeMode, derived.conciergeModeSetBy, derived.conciergeModeReason, row.id],
          );
          rowsBackfilled++;
        }
        reportProgress(i + 1, rows.length, 'chats');
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added the Concierge mode columns to chats and backfilled them', {
        context: 'migration.add-chat-concierge-mode',
        columnsAdded,
        rowsBackfilled,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: columnsAdded + rowsBackfilled,
        message: `Added ${columnsAdded} Concierge mode column(s); backfilled ${rowsBackfilled} chat(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add the Concierge mode columns', {
        context: 'migration.add-chat-concierge-mode',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: columnsAdded + rowsBackfilled,
        message: 'Failed to add the Concierge mode columns',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
