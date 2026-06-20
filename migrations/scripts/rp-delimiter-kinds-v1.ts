/**
 * Migration: Roleplay Delimiter Kinds
 *
 * Adds a `kind` discriminant to every delimiter entry in `roleplay_templates`
 * so the formatting system models "wrap" vs "line prefix" (and, going forward,
 * user-authored "tag prefix") explicitly instead of inferring prefix-ness from
 * an empty close delimiter.
 *
 * Per delimiter:
 *   - `[marker, '']` (an empty close) → { kind: 'linePrefix', marker }
 *   - a string, or `[open, close]` with a non-empty close → { kind: 'wrap', delimiters }
 *
 * No existing entry becomes a `tagPrefix` — that kind is a user-authored
 * capability only. `renderingPatterns` are then regenerated from the migrated
 * delimiters (via the single-source-of-truth `generateRenderingPatterns`), so
 * line-prefix rules pick up their `scope: 'line'` marker.
 *
 * Built-in templates are re-seeded from `BUILT_IN_TEMPLATES` on every startup,
 * so this migration only needs to fix user-authored rows; the built-in seeds
 * were updated to the new shape in the same change.
 *
 * Migration ID: rp-delimiter-kinds-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import { generateRenderingPatterns } from '@/lib/chat/annotations';
import type { TemplateDelimiter, NarrationDelimiters } from '@/lib/schemas/template.types';

/** A pre-migration delimiter entry (no `kind`). */
interface LegacyDelimiter {
  name?: string;
  buttonName?: string;
  delimiters?: string | [string, string];
  style?: string;
}

/** Classify a single legacy delimiter into a kind-tagged delimiter. Pass through
 *  anything that already carries a `kind`. Returns null for unusable entries. */
function classifyDelimiter(entry: unknown): TemplateDelimiter | null {
  if (!entry || typeof entry !== 'object') return null;
  if ('kind' in entry) return entry as TemplateDelimiter; // already migrated

  const d = entry as LegacyDelimiter;
  const name = (d.name || '').trim();
  const buttonName = (d.buttonName || '').trim();
  const style = (d.style || 'qt-chat-narration').trim() || 'qt-chat-narration';
  if (!name || !buttonName) return null;

  // A tuple with an empty close is a line-start marker (e.g. ['// ', '']).
  if (Array.isArray(d.delimiters) && d.delimiters[1] === '' && d.delimiters[0]) {
    return { kind: 'linePrefix', name, buttonName, marker: d.delimiters[0], style };
  }

  // Everything else is a wrap delimiter (string ⇒ same open/close; tuple ⇒ pair).
  return {
    kind: 'wrap',
    name,
    buttonName,
    delimiters: d.delimiters ?? '',
    style,
  };
}

export const rpDelimiterKindsMigration: Migration = {
  id: 'rp-delimiter-kinds-v1',
  description: 'Add a kind discriminant (wrap/linePrefix) to roleplay-template delimiters and regenerate rendering patterns',
  introducedInVersion: '4.7.0',
  dependsOn: ['migrate-plugin-templates-to-native-v1', 'add-narration-delimiters-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('roleplay_templates')) return false;

    const db = getSQLiteDatabase();
    const rows = db.prepare('SELECT delimiters FROM "roleplay_templates"').all() as Array<{ delimiters: string | null }>;
    // Run if any row has at least one delimiter entry lacking `kind`.
    for (const row of rows) {
      if (!row.delimiters) continue;
      try {
        const parsed = JSON.parse(row.delimiters);
        if (Array.isArray(parsed) && parsed.some((d) => d && typeof d === 'object' && !('kind' in d))) {
          return true;
        }
      } catch {
        // Unparseable JSON — leave it for the run() try/catch to skip.
      }
    }
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      const rows = db.prepare(
        'SELECT id, delimiters, narrationDelimiters FROM "roleplay_templates"',
      ).all() as Array<{ id: string; delimiters: string | null; narrationDelimiters: string | null }>;

      const update = db.prepare(
        'UPDATE "roleplay_templates" SET delimiters = ?, renderingPatterns = ?, updatedAt = ? WHERE id = ?',
      );

      let itemsAffected = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        reportProgress(i + 1, rows.length, 'templates');

        let legacy: unknown[];
        try {
          legacy = row.delimiters ? JSON.parse(row.delimiters) : [];
        } catch {
          continue; // skip unparseable rows untouched
        }
        if (!Array.isArray(legacy)) continue;

        // Only touch rows that actually carry a kind-less entry.
        const needsMigration = legacy.some((d) => d && typeof d === 'object' && !('kind' in d));
        if (!needsMigration) continue;

        const migrated = legacy
          .map(classifyDelimiter)
          .filter((d): d is TemplateDelimiter => d !== null);

        // Regenerate rendering patterns from the migrated delimiters so line
        // prefixes gain scope: 'line'. Parse narrationDelimiters (JSON string).
        let narration: NarrationDelimiters | undefined;
        try {
          narration = row.narrationDelimiters ? JSON.parse(row.narrationDelimiters) : undefined;
        } catch {
          narration = undefined;
        }
        const patterns = generateRenderingPatterns(migrated, narration);

        update.run(
          JSON.stringify(migrated),
          JSON.stringify(patterns),
          new Date().toISOString(),
          row.id,
        );
        itemsAffected++;
      }

      const durationMs = Date.now() - startTime;

      logger.info('Migrated roleplay-template delimiters to kind discriminant', {
        context: 'migration.rp-delimiter-kinds',
        itemsAffected,
        totalRows: rows.length,
        durationMs,
      });

      return {
        id: 'rp-delimiter-kinds-v1',
        success: true,
        itemsAffected,
        message: `Tagged delimiters with kind across ${itemsAffected} template(s)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to migrate roleplay-template delimiter kinds', {
        context: 'migration.rp-delimiter-kinds',
        error: errorMessage,
      });

      return {
        id: 'rp-delimiter-kinds-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to migrate roleplay-template delimiter kinds',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
