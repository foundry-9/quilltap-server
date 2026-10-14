/**
 * Migration: Impersonated-Line Voice — Boolean to Three States
 *
 * `chat_settings.impersonationVoiceRewrite` (INTEGER 0/1, added earlier in
 * 4.10 development) becomes `chat_settings.impersonationVoiceMode` (TEXT:
 * 'off' / 'ask' / 'always'). The translation is
 * `impersonationVoiceModeFromLegacy` (`lib/chat/impersonation-voice-legacy.ts`):
 * 1 → 'ask', anything else → 'off'. 'ask' rather than 'always' is the
 * deliberate behaviour change of record — the dialog still opens, but no model
 * is called until the operator asks for a restatement.
 *
 * The old column is dropped in the same pass once every row is translated. No
 * index or trigger names it, so a plain `ALTER TABLE ... DROP COLUMN` is
 * enough (SQLite 3.35+). Backups that still carry the field are translated on
 * restore by `withImpersonationVoiceModeFromLegacy`.
 *
 * Re-runnable: it runs while the new column is missing or the old one remains,
 * and only rows still at the column default are backfilled.
 *
 * Migration ID: impersonation-voice-mode-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
  querySQLite,
  executeSQLite,
} from '../lib/database-utils';
import { impersonationVoiceModeFromLegacy } from '@/lib/chat/impersonation-voice-legacy';

const MIGRATION_ID = 'impersonation-voice-mode-v1';
const CONTEXT = 'migration.impersonation-voice-mode';

interface LegacyRow {
  id: string;
  impersonationVoiceRewrite: number | null;
}

export const impersonationVoiceModeMigration: Migration = {
  id: MIGRATION_ID,
  description:
    "Replace chat_settings.impersonationVoiceRewrite (on/off) with impersonationVoiceMode ('off' / 'ask' / 'always')",
  introducedInVersion: '4.10.0',
  dependsOn: ['add-impersonation-voice-rewrite-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('chat_settings')) {
      return false;
    }
    return (
      !sqliteColumnExists('chat_settings', 'impersonationVoiceMode')
      || sqliteColumnExists('chat_settings', 'impersonationVoiceRewrite')
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;
    let rowsBackfilled = 0;
    let columnsDropped = 0;

    try {
      if (addColumnIfMissing('chat_settings', 'impersonationVoiceMode', "TEXT DEFAULT 'off'")) {
        columnsAdded++;
      }

      if (sqliteColumnExists('chat_settings', 'impersonationVoiceRewrite')) {
        const rows = querySQLite<LegacyRow>(
          `SELECT "id", "impersonationVoiceRewrite" FROM "chat_settings" ` +
          `WHERE "impersonationVoiceMode" IS NULL OR "impersonationVoiceMode" = 'off'`,
        );

        logger.debug('Translating the impersonated-line voice toggle', {
          context: CONTEXT,
          candidates: rows.length,
        });

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const mode = impersonationVoiceModeFromLegacy(row.impersonationVoiceRewrite);
          executeSQLite(
            `UPDATE "chat_settings" SET "impersonationVoiceMode" = ? WHERE "id" = ?`,
            [mode, row.id],
          );
          rowsBackfilled++;
          logger.debug('Translated one impersonated-line voice setting', {
            context: CONTEXT,
            settingsId: row.id,
            legacy: row.impersonationVoiceRewrite,
            mode,
          });
          reportProgress(i + 1, rows.length, 'settings');
        }

        getSQLiteDatabase().exec('ALTER TABLE "chat_settings" DROP COLUMN "impersonationVoiceRewrite"');
        columnsDropped++;
      }

      const durationMs = Date.now() - startTime;
      logger.info('Replaced the impersonated-line voice toggle with a three-state mode', {
        context: CONTEXT,
        columnsAdded,
        rowsBackfilled,
        columnsDropped,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: columnsAdded + rowsBackfilled + columnsDropped,
        message: `Added ${columnsAdded} column(s); translated ${rowsBackfilled} settings row(s); dropped ${columnsDropped} legacy column(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to replace the impersonated-line voice toggle', {
        context: CONTEXT,
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: columnsAdded + rowsBackfilled + columnsDropped,
        message: 'Failed to replace the impersonated-line voice toggle',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
