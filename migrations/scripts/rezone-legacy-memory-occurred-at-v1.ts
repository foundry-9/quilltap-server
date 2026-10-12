/**
 * Migration: Re-stamp legacy UTC-midnight memory event dates on the instance's
 * memory calendar.
 *
 * Before bug 212, `resolveWhenPhrase` stamped a resolved `when` phrase
 * ("yesterday", "July 14", "2026-07-14", "three days ago") at UTC midnight of
 * its calendar day. Since that fix the anchor line, the day-reference windows
 * and the keyword distillation all read `memories.occurredAt` on the instance's
 * memory calendar (instance timezone → QUILLTAP_TIMEZONE → system), where a
 * UTC midnight is the previous evening anywhere west of Greenwich — so a legacy
 * "2026-07-14T00:00Z" read as "when: 2026-07-13" in America/Chicago and fell
 * outside the window for July 14. The memory system refactor's decision 10
 * originally chose no backfill; the owner's review of PR 90 asked for this one.
 *
 * Every row whose `occurredAt` is exactly a UTC midnight is re-stamped at local
 * midnight of the same calendar date in the instance zone. New resolutions
 * stamp the start of a LOCAL window instead: local midnight (a UTC midnight
 * only where the offset is zero on that date, where the rewrite is a no-op),
 * the turn's own instant, or — for "last night" — 18:00 local the day before.
 * That last one IS a UTC midnight in a UTC−6 zone (America/Chicago in winter,
 * America/Mexico_City, Central America). The migration still rewrites every
 * UTC-midnight row: it runs once, at startup, before the new resolver has
 * written anything, so on an ordinary upgrade every such row is legacy —
 * however recently old code wrote it. (A cutoff on `createdAt` would be wrong:
 * an instance that keeps running old code after the fix lands keeps writing
 * legacy rows.) The one residual case is an instance that ran the bug-212 code
 * before this migration existed, in a UTC−6 zone, with a "last night" row —
 * development instances only. Non-midnight values — turn timestamps, the 4.9
 * backfill from message createdAt — are never touched.
 *
 * The embedded anchor line needs no re-embed: legacy vectors were built from
 * the stored date's first ten characters (the UTC date), and the re-stamped
 * value reads the same calendar date in the instance zone.
 *
 * The zone is resolved the way `refreshMemoryTimeZone` resolves it (the first
 * valid `chat_settings.timezone`, then `getMemoryTimeZone`'s env/system
 * fallback), reading through the migration's own database handle.
 *
 * Migration ID: rezone-legacy-memory-occurred-at-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  sqliteColumnExists,
} from '../lib/database-utils';
import {
  getMemoryTimeZone,
  isValidTimeZone,
  zonedDayBoundsIso,
} from '@/lib/memory/memory-calendar';

const MIGRATION_ID = 'rezone-legacy-memory-occurred-at-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
const BATCH_SIZE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

interface OccurredAtRow {
  id: string;
  occurredAt: string;
}

/** The instance's memory-calendar zone, read through the migration's handle. */
function resolveInstanceTimeZone(db: ReturnType<typeof getSQLiteDatabase>): string {
  let configured: string | null = null;
  if (sqliteTableExists('chat_settings') && sqliteColumnExists('chat_settings', 'timezone')) {
    const rows = db
      .prepare(`SELECT timezone FROM chat_settings WHERE timezone IS NOT NULL`)
      .all() as Array<{ timezone: string | null }>;
    configured = rows.find((r) => isValidTimeZone(r.timezone))?.timezone ?? null;
  }
  return getMemoryTimeZone(configured);
}

/** Local midnight of `occurredAt`'s UTC date, or null when it is not a UTC midnight. */
function rezonedValue(occurredAt: string, timeZone: string): string | null {
  const ms = Date.parse(occurredAt);
  if (!Number.isFinite(ms) || ms % DAY_MS !== 0) return null;
  const date = new Date(ms).toISOString().slice(0, 10);
  const local = zonedDayBoundsIso(date, timeZone)?.from ?? null;
  return local && local !== occurredAt ? local : null;
}

export const rezoneLegacyMemoryOccurredAtMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Re-stamp legacy UTC-midnight memories.occurredAt values at local midnight of the same date on the instance memory calendar',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-episodic-memory-fields-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('memories')) return false;
    return sqliteColumnExists('memories', 'occurredAt');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;

    try {
      const db = getSQLiteDatabase();
      const timeZone = resolveInstanceTimeZone(db);

      // Narrow in SQL to values carrying a midnight time; the exact UTC-midnight
      // test is done on the parsed instant. Read up front — better-sqlite3
      // cannot write mid-iterate.
      const rows = db
        .prepare(
          `SELECT id, occurredAt FROM memories WHERE occurredAt IS NOT NULL AND occurredAt LIKE '%T00:00:00%'`,
        )
        .all() as OccurredAtRow[];
      const total = rows.length;
      logger.info('Re-stamping legacy UTC-midnight memory dates', {
        context: LOG_CONTEXT,
        timeZone,
        candidates: total,
      });

      const update = db.prepare(`UPDATE memories SET occurredAt = ? WHERE id = ?`);
      const applyBatch = db.transaction((batch: Array<{ id: string; value: string }>) => {
        for (const item of batch) update.run(item.value, item.id);
      });

      for (let start = 0; start < total; start += BATCH_SIZE) {
        const slice = rows.slice(start, start + BATCH_SIZE);
        const changes: Array<{ id: string; value: string }> = [];
        for (const row of slice) {
          const value = rezonedValue(row.occurredAt, timeZone);
          if (value) changes.push({ id: row.id, value });
        }
        if (changes.length > 0) {
          applyBatch(changes);
          itemsAffected += changes.length;
        }
        const done = Math.min(start + BATCH_SIZE, total);
        reportProgress(done, total, 'memories');
        logger.debug('Re-stamped memory-date batch', {
          context: LOG_CONTEXT,
          scanned: done,
          total,
          rewritten: changes.length,
        });
      }

      logger.info('Re-stamped legacy UTC-midnight memory dates', {
        context: LOG_CONTEXT,
        timeZone,
        candidates: total,
        rewritten: itemsAffected,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Re-stamped ${itemsAffected} legacy memory date(s) at local midnight in ${timeZone}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Legacy memory-date re-stamp failed', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected,
        message: `Legacy memory-date re-stamp failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
