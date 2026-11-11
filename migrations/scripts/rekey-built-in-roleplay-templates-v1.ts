/**
 * Migration: Give the Built-in Roleplay Templates Their Fixed Ids
 *
 * Built-in roleplay templates used to be seeded under a random id per
 * instance, so a chat restored or imported elsewhere named a template that did
 * not exist there (#190). They now have a UUIDv5 id derived from their name
 * (`lib/roleplay-templates/built-in-ids.ts`), the same on every instance.
 *
 * This re-keys each built-in row seeded under the old scheme and every main-
 * database pointer to it — the fields the id-field table
 * (`lib/backup/id-fields.ts`) aims at `roleplayTemplate`:
 *
 * - `characters.defaultRoleplayTemplateId`
 * - `chats.roleplayTemplateId` and `chats.participants[].roleplayTemplateId`
 * - `chat_settings.defaultRoleplayTemplateId`
 *
 * A project's `defaultRoleplayTemplateId` lives in its store's
 * `properties.json`, which only the store-backed repository writes safely, so
 * the old → new map is left in `instance_settings`
 * (`builtInRoleplayTemplateRekeys`) for the boot step
 * `rekeyProjectRoleplayTemplatePointers` to apply and clear.
 *
 * Idempotent: a built-in already under its fixed id is left alone. A second
 * row for the same built-in (a duplicate seeded by a race) is folded into the
 * first: its pointers move and the row is deleted.
 *
 * Migration ID: rekey-built-in-roleplay-templates-v1
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import { isSQLiteBackend, sqliteTableExists, getSQLiteDatabase, tableExists, columnExists } from '../lib/database-utils';
import {
  BUILT_IN_ROLEPLAY_TEMPLATE_NAMES,
  builtInRoleplayTemplateId,
} from '../../lib/roleplay-templates/built-in-ids';

const MIGRATION_ID = 'rekey-built-in-roleplay-templates-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
export const BUILT_IN_REKEYS_SETTING_KEY = 'builtInRoleplayTemplateRekeys';

/** Built-in rows whose id is not the fixed one for their name: old id → new id. */
function planRekeys(db: DatabaseType): Map<string, string> {
  const names = new Set<string>(BUILT_IN_ROLEPLAY_TEMPLATE_NAMES);
  const rows = db
    .prepare('SELECT id, name FROM roleplay_templates WHERE isBuiltIn = 1')
    .all() as Array<{ id: string; name: string }>;
  const plan = new Map<string, string>();
  for (const row of rows) {
    if (!names.has(row.name)) continue;
    const fixed = builtInRoleplayTemplateId(row.name);
    if (row.id !== fixed) plan.set(row.id, fixed);
  }
  return plan;
}

/** Rewrite `roleplayTemplateId` inside a chat's participants JSON. */
function rekeyParticipants(raw: string, plan: ReadonlyMap<string, string>): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  let changed = false;
  const next = parsed.map((participant) => {
    if (!participant || typeof participant !== 'object') return participant;
    const current = (participant as Record<string, unknown>).roleplayTemplateId;
    if (typeof current !== 'string' || !plan.has(current)) return participant;
    changed = true;
    return { ...participant, roleplayTemplateId: plan.get(current) };
  });
  return changed ? JSON.stringify(next) : null;
}

export const rekeyBuiltInRoleplayTemplatesMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Give the built-in roleplay templates fixed ids and re-point everything that names them (#190)',
  introducedInVersion: '4.13.0',
  dependsOn: ['sqlite-initial-schema-v1', 'add-roleplay-template-unmarked-fields-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('roleplay_templates')) return false;
    return planRekeys(getSQLiteDatabase()).size > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const db = getSQLiteDatabase();
    let itemsAffected = 0;

    try {
      const plan = planRekeys(db);
      logger.info('Re-keying built-in roleplay templates', { context: LOG_CONTEXT, templates: plan.size });

      const apply = db.transaction(() => {
        let rowsTouched = 0;
        let step = 0;
        for (const [oldId, newId] of plan) {
          step++;
          reportProgress(step, plan.size, 'templates');
          const fixedExists = db.prepare('SELECT 1 FROM roleplay_templates WHERE id = ?').get(newId);
          if (fixedExists) {
            // A second row for the same built-in: fold it into the first.
            db.prepare('DELETE FROM roleplay_templates WHERE id = ?').run(oldId);
          } else {
            db.prepare('UPDATE roleplay_templates SET id = ? WHERE id = ?').run(newId, oldId);
          }
          rowsTouched++;

          for (const [table, column] of [
            ['characters', 'defaultRoleplayTemplateId'],
            ['chats', 'roleplayTemplateId'],
            ['chat_settings', 'defaultRoleplayTemplateId'],
          ] as const) {
            if (!tableExists(db, table) || !columnExists(db, table, column)) continue;
            rowsTouched += db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${column}" = ?`).run(newId, oldId).changes;
          }
        }

        if (tableExists(db, 'chats') && columnExists(db, 'chats', 'participants')) {
          const candidates = db
            .prepare("SELECT id, participants FROM chats WHERE participants LIKE '%roleplayTemplateId%'")
            .all() as Array<{ id: string; participants: string | null }>;
          const update = db.prepare('UPDATE chats SET participants = ? WHERE id = ?');
          for (const [index, chat] of candidates.entries()) {
            reportProgress(index + 1, candidates.length, 'chats');
            if (!chat.participants) continue;
            const next = rekeyParticipants(chat.participants, plan);
            if (next !== null) {
              update.run(next, chat.id);
              rowsTouched++;
            }
          }
        }

        // Project pointers live in project stores; the boot step applies these.
        if (tableExists(db, 'instance_settings')) {
          const existing = db
            .prepare('SELECT value FROM instance_settings WHERE key = ?')
            .get(BUILT_IN_REKEYS_SETTING_KEY) as { value: string } | undefined;
          let merged: Record<string, string> = {};
          try {
            merged = existing ? (JSON.parse(existing.value) as Record<string, string>) : {};
          } catch {
            merged = {};
          }
          for (const [oldId, newId] of plan) merged[oldId] = newId;
          db.prepare(
            'INSERT INTO instance_settings ("key", "value") VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"'
          ).run(BUILT_IN_REKEYS_SETTING_KEY, JSON.stringify(merged));
        }
        return rowsTouched;
      });

      itemsAffected = apply();
      const durationMs = Date.now() - startTime;
      logger.info('Re-keyed built-in roleplay templates', { context: LOG_CONTEXT, templates: plan.size, itemsAffected, durationMs });
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Re-keyed ${plan.size} built-in roleplay template(s); ${itemsAffected} row(s) updated`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to re-key built-in roleplay templates', { context: LOG_CONTEXT, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected,
        message: `Failed to re-key built-in roleplay templates: ${errorMessage}`,
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
