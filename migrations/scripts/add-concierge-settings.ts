/**
 * Migration: Add the Concierge Settings Column
 *
 * Concierge overhaul phase 4 gives the Concierge one settings object,
 * `chat_settings.conciergeSettings` (JSON TEXT), replacing
 * `dangerousContentSettings` and absorbing two settings stored elsewhere:
 * the uncensored vision fallback (`uncensoredImageDescriptionProfileId`) and
 * the image-prompt crafter (`cheapLLMSettings.imagePromptProfileId`).
 *
 * The retired global mode translates as:
 *
 *   OFF          → enabled: false (pre-screen and summary classification off)
 *   DETECT_ONLY  → enabled: true, preScreen.enabled: true, summaryClassification: true
 *   AUTO_ROUTE   → enabled: true, preScreen.enabled: true, summaryClassification: true
 *
 * DETECT_ONLY gaining failover is the deliberate behaviour change of record.
 * One refinement keeps an explicit operator choice alive: under the old
 * resolver an Unmoderated chat routed to the uncensored desk even under a
 * global OFF, so an OFF user who has any Unmoderated chat is translated to
 * `enabled: true` with the pre-screen off — otherwise those chats would
 * silently fall back to the ordinary providers.
 *
 * The old columns are left in place (no longer read); a later housekeeping
 * migration drops them. Only rows with no `conciergeSettings` yet are
 * touched, so a re-run changes nothing.
 *
 * Migration ID: add-concierge-settings-v1
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
import {
  mapLegacyConciergeSettings,
  type LegacyDangerousContentSettings,
} from '../../lib/services/dangerous-content/legacy-concierge-settings';

export { mapLegacyConciergeSettings };

const MIGRATION_ID = 'add-concierge-settings-v1';

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

interface SettingsRow {
  id: string;
  userId: string;
  dangerousContentSettings: string | null;
  uncensoredImageDescriptionProfileId: string | null;
  cheapLLMSettings: string | null;
}

export const addConciergeSettingsMigration: Migration = {
  id: MIGRATION_ID,
  description: "Add chat_settings.conciergeSettings and backfill it from dangerousContentSettings, the uncensored vision fallback and the image-prompt crafter",
  introducedInVersion: '4.10.0',
  // add-chat-concierge-mode-v1 first, so the OFF-with-Unmoderated-chats rule can see chat states.
  dependsOn: ['add-dangerous-content-fields-v1', 'add-chat-concierge-mode-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('chat_settings')) {
      return false;
    }
    if (!sqliteColumnExists('chat_settings', 'conciergeSettings')) {
      return true;
    }
    const [{ n }] = querySQLite<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "chat_settings" WHERE "conciergeSettings" IS NULL OR "conciergeSettings" = ''`,
    );
    return n > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;
    let rowsBackfilled = 0;

    try {
      if (addColumnIfMissing('chat_settings', 'conciergeSettings', 'TEXT DEFAULT NULL')) {
        columnsAdded++;
      }

      const col = (name: string) =>
        sqliteColumnExists('chat_settings', name) ? `"${name}"` : `NULL AS "${name}"`;

      const rows = querySQLite<SettingsRow>(
        `SELECT "id", "userId", ${col('dangerousContentSettings')}, ` +
        `${col('uncensoredImageDescriptionProfileId')}, ${col('cheapLLMSettings')} ` +
        `FROM "chat_settings" WHERE "conciergeSettings" IS NULL OR "conciergeSettings" = ''`,
      );

      const canSeeChatModes = sqliteTableExists('chats') && sqliteColumnExists('chats', 'conciergeMode');

      logger.debug('Backfilling the Concierge settings', {
        context: 'migration.add-concierge-settings',
        candidates: rows.length,
        canSeeChatModes,
      });

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const hasUnmoderatedChats = canSeeChatModes
          ? querySQLite<{ n: number }>(
              `SELECT COUNT(*) AS n FROM "chats" WHERE "userId" = ? AND "conciergeMode" = 'unmoderated'`,
              [row.userId],
            )[0].n > 0
          : false;

        const migrated = mapLegacyConciergeSettings({
          dangerousContentSettings: parseJson<LegacyDangerousContentSettings>(row.dangerousContentSettings),
          uncensoredImageDescriptionProfileId: row.uncensoredImageDescriptionProfileId,
          cheapLLMSettings: parseJson<{ imagePromptProfileId?: string | null }>(row.cheapLLMSettings),
          hasUnmoderatedChats,
        });

        logger.debug('Translated one user\'s Concierge settings', {
          context: 'migration.add-concierge-settings',
          settingsId: row.id,
          enabled: migrated.enabled,
          preScreen: migrated.preScreen.enabled,
          hasUnmoderatedChats,
        });

        executeSQLite(
          `UPDATE "chat_settings" SET "conciergeSettings" = ? WHERE "id" = ?`,
          [JSON.stringify(migrated), row.id],
        );
        rowsBackfilled++;
        reportProgress(i + 1, rows.length, 'settings');
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added the Concierge settings column and backfilled it', {
        context: 'migration.add-concierge-settings',
        columnsAdded,
        rowsBackfilled,
        durationMs,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: columnsAdded + rowsBackfilled,
        message: `Added ${columnsAdded} Concierge settings column(s); backfilled ${rowsBackfilled} settings row(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add the Concierge settings column', {
        context: 'migration.add-concierge-settings',
        error: errorMessage,
      });

      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: columnsAdded + rowsBackfilled,
        message: 'Failed to add the Concierge settings column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
