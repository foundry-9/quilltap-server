/**
 * Migration: Retire the `[Name]` Prefill on Claude Served Through a Gateway
 *
 * Anthropic 4.6+ rejects a request that ends with an assistant message ("This
 * model does not support assistant message prefill. The conversation must end
 * with a user message."). The prefill default was off for ANTHROPIC profiles
 * only, so a profile reaching Claude through another provider — OpenRouter's
 * `anthropic/claude-sonnet-5`, NanoGPT's `claude-…`, an OpenAI-compatible
 * proxy — was created with the prefill on. The setup wizard creates exactly
 * such a profile when OpenRouter is chosen with a Claude model, and every
 * multi-character turn then fails, including the chat's opening greeting (a
 * chat with a user character is a multi-character chat).
 *
 * The default now follows the model as well as the provider
 * (`refusesAssistantPrefill` in `lib/llm/multi-character-prefill.ts`). This
 * pass clears the literal `1` that the old default wrote onto existing
 * profiles whose model is Claude. A stored `1` there cannot work against a
 * recent Claude model, so clearing it costs nothing that was working; anyone
 * on an older Claude that tolerated the prefill can tick the box again, and
 * that choice is still honoured over every default.
 *
 * **The pattern below is a deliberate frozen copy** of the runtime rule as it
 * stood when this was written. Do not make it follow the library later — a
 * migration describes the world it ran in.
 *
 * Migration ID: retire-prefill-on-gateway-claude-profiles-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

const MIGRATION_ID = 'retire-prefill-on-gateway-claude-profiles-v1';

/** Frozen copy of the runtime Claude-model rule. See the module note. */
const FROZEN_CLAUDE_MODEL_PATTERN = /(^|[^a-z0-9])claude([^a-z0-9]|$)/i;

interface ProfileRow {
  id: string;
  provider: string | null;
  modelName: string | null;
}

export const retirePrefillOnGatewayClaudeProfilesMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Turn the multi-character [Name] prefill off on connection profiles that reach a Claude model through another provider, which rejects a prefilled assistant turn',
  introducedInVersion: '4.14.0',
  dependsOn: ['add-profile-multi-character-prefill-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }
    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }
    const columns = getSQLiteTableColumns('connection_profiles');
    return columns.some((col) => col.name === 'multiCharacterPrefill');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // Anthropic profiles already default off; only the gateways carried the
      // stale 1.
      const rows = db
        .prepare(
          `SELECT "id", "provider", "modelName"
             FROM "connection_profiles"
            WHERE "multiCharacterPrefill" = 1
              AND upper(coalesce("provider", '')) != 'ANTHROPIC'`
        )
        .all() as ProfileRow[];

      const clear = db.prepare(
        'UPDATE "connection_profiles" SET "multiCharacterPrefill" = 0 WHERE "id" = ?'
      );

      let cleared = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.modelName && FROZEN_CLAUDE_MODEL_PATTERN.test(row.modelName)) {
          clear.run(row.id);
          cleared++;
          logger.debug('Turned the [Name] prefill off on a gateway Claude profile', {
            context: `migration.${MIGRATION_ID}`,
            profileId: row.id,
            provider: row.provider,
            modelName: row.modelName,
          });
        }
        reportProgress(i + 1, rows.length, 'connection profiles');
      }

      logger.info('Retired the [Name] prefill on gateway Claude profiles', {
        context: `migration.${MIGRATION_ID}`,
        examined: rows.length,
        cleared,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: cleared,
        message: `Examined ${rows.length} prefill-enabled non-Anthropic profile(s); turned the [Name] prefill off on ${cleared} serving a Claude model`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to retire the [Name] prefill on gateway Claude profiles', {
        context: `migration.${MIGRATION_ID}`,
        error: message,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: `Failed to retire the [Name] prefill on gateway Claude profiles: ${message}`,
        error: message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
