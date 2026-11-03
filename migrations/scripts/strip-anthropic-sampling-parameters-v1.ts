/**
 * Migration: Strip Sampling Parameters from Anthropic Profiles
 *
 * The Anthropic plugin now uses its SDK's default API version, 2026-10-21,
 * which returns a 400 for any Messages request carrying `temperature`, `top_p`
 * or `top_k` — on every model, even at the default value. The plugin no longer
 * sends them and declares `capabilities.samplingParameters: false`, and the
 * connection-profiles repository strips them on every write. Rows written
 * before that still carry the keys, and the profile card and any export would
 * keep showing values that do nothing. This pass removes them once.
 *
 * Only the sampling keys go; `max_tokens` and the Anthropic provider options
 * (caching, thinking) are kept.
 *
 * **The provider list is a deliberate frozen copy.** At runtime the question
 * is answered by each plugin's `capabilities.samplingParameters`, but
 * migrations run before the plugin registry is up, so this one names the
 * providers that declared `false` the day it was written. Do not "fix" it to
 * follow the plugins later — a migration describes the world it ran in.
 *
 * Migration ID: strip-anthropic-sampling-parameters-v1
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
import { withoutSamplingParameters } from '@/lib/llm/sampling-params';

/** Providers that declared `samplingParameters: false` when this was written. */
const FROZEN_PROVIDERS = ['ANTHROPIC'];

interface ProfileRow {
  id: string;
  parameters: string | null;
}

function parseParameters(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const stripAnthropicSamplingParametersMigration: Migration = {
  id: 'strip-anthropic-sampling-parameters-v1',
  description:
    'Remove temperature, top_p and top_k from Anthropic connection profiles, which API version 2026-10-21 refuses on every model',
  introducedInVersion: '4.12.0',
  dependsOn: [],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles')) {
      return false;
    }

    const columns = getSQLiteTableColumns('connection_profiles');
    return columns.some((col) => col.name === 'parameters');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      const placeholders = FROZEN_PROVIDERS.map(() => '?').join(', ');
      const rows = db
        .prepare(
          `SELECT "id", "parameters"
             FROM "connection_profiles"
            WHERE upper("provider") IN (${placeholders})`
        )
        .all(...FROZEN_PROVIDERS) as ProfileRow[];

      const write = db.prepare(
        'UPDATE "connection_profiles" SET "parameters" = ? WHERE "id" = ?'
      );

      let cleaned = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const params = parseParameters(row.parameters);
        if (params) {
          const { parameters, removed } = withoutSamplingParameters(params);
          if (removed.length > 0) {
            write.run(JSON.stringify(parameters), row.id);
            cleaned++;
            logger.debug('Stripped sampling parameters from Anthropic profile', {
              context: 'migration.strip-anthropic-sampling-parameters',
              profileId: row.id,
              removed,
            });
          }
        }

        reportProgress(i + 1, rows.length, 'connection profiles');
      }

      logger.info('Stripped sampling parameters from Anthropic connection profiles', {
        context: 'migration.strip-anthropic-sampling-parameters',
        examined: rows.length,
        cleaned,
      });

      return {
        id: 'strip-anthropic-sampling-parameters-v1',
        success: true,
        itemsAffected: cleaned,
        message: `Examined ${rows.length} Anthropic profile(s); removed sampling parameters from ${cleaned}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to strip sampling parameters from Anthropic profiles', {
        context: 'migration.strip-anthropic-sampling-parameters',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        id: 'strip-anthropic-sampling-parameters-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to strip sampling parameters from Anthropic profiles: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
