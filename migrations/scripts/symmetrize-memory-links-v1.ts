/**
 * Migration: Give every one-way link between two of a holder's memories its
 * missing other side.
 *
 * Links between memories (`memories.relatedMemoryIds`) are two-way by design:
 * admission's insert-linked, the episode pass and a hand edit all write both
 * rows (`linkBothWays`, `updateMemory`). Before refactor 4.13, memory
 * consolidation wrote a digest's and its neighbours' link lists as absolute
 * values computed from the corpus as it stood when the maintenance run began
 * (A9), so a link admission added to either side in between could be
 * overwritten on one row and survive on the other. Consolidation now writes
 * links as deltas; this pass repairs the one-way links the old writes left.
 *
 * Only the missing reverse side is added, and only between two rows that both
 * exist and belong to the same holder: a link to another holder's memory can
 * come from an import or legacy data and is left as it is, and a link to a row
 * that no longer exists is the graph repair's business
 * (`?action=repair`, `scrubDanglingMemoryLinks`). Nothing is removed. Links do
 * not feed the embedded text, so no row is re-embedded.
 *
 * Migration ID: symmetrize-memory-links-v1
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

const MIGRATION_ID = 'symmetrize-memory-links-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;
const BATCH_SIZE = 500;

interface LinkRow {
  id: string;
  characterId: string;
  relatedMemoryIds: string | null;
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * For each row, the ids it must gain so every same-holder link it is named in
 * is two-way. Pure (exported for tests). Order of the additions follows the
 * order the naming rows were given.
 */
export function missingReverseLinks(rows: ReadonlyArray<{ id: string; characterId: string; links: readonly string[] }>): Map<string, string[]> {
  const byId = new Map(rows.map((r) => [r.id, { characterId: r.characterId, links: new Set(r.links) }]));
  const additions = new Map<string, string[]>();
  for (const row of rows) {
    for (const target of row.links) {
      if (target === row.id) continue;
      const other = byId.get(target);
      if (!other || other.characterId !== row.characterId || other.links.has(row.id)) continue;
      const list = additions.get(target) ?? [];
      if (!list.includes(row.id)) list.push(row.id);
      additions.set(target, list);
    }
  }
  return additions;
}

export const symmetrizeMemoryLinksMigration: Migration = {
  id: MIGRATION_ID,
  description: "Add the missing other side of one-way links between a holder's memories",
  introducedInVersion: '4.13.0',

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('memories')) return false;
    return sqliteColumnExists('memories', 'relatedMemoryIds');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let itemsAffected = 0;
    let linksAdded = 0;

    try {
      const db = getSQLiteDatabase();
      // Read up front: better-sqlite3 cannot write mid-iterate. Only the link
      // columns, so the vectors are never loaded.
      const raw = db
        .prepare(`SELECT id, characterId, relatedMemoryIds FROM memories`)
        .all() as LinkRow[];
      const rows = raw.map((r) => ({ id: r.id, characterId: r.characterId, links: parseIds(r.relatedMemoryIds) }));
      const additions = missingReverseLinks(rows);
      const current = new Map(rows.map((r) => [r.id, r.links]));
      const targets = [...additions.keys()];
      const total = targets.length;
      logger.info('Making one-way memory links two-way', {
        context: LOG_CONTEXT,
        rows: rows.length,
        rowsToFix: total,
      });

      const now = new Date().toISOString();
      const update = db.prepare(`UPDATE memories SET relatedMemoryIds = ?, updatedAt = ? WHERE id = ?`);
      const applyBatch = db.transaction((batch: Array<{ id: string; links: string[] }>) => {
        for (const item of batch) update.run(JSON.stringify(item.links), now, item.id);
      });

      for (let start = 0; start < total; start += BATCH_SIZE) {
        const slice = targets.slice(start, start + BATCH_SIZE);
        const batch = slice.map((id) => {
          const add = additions.get(id) ?? [];
          linksAdded += add.length;
          return { id, links: [...(current.get(id) ?? []), ...add] };
        });
        applyBatch(batch);
        itemsAffected += batch.length;
        const done = Math.min(start + BATCH_SIZE, total);
        reportProgress(done, total, 'memories');
        logger.debug('Two-way link batch written', { context: LOG_CONTEXT, done, total });
      }

      logger.info('Made one-way memory links two-way', {
        context: LOG_CONTEXT,
        rowsChanged: itemsAffected,
        linksAdded,
      });
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected,
        message: `Added ${linksAdded} missing reverse link(s) on ${itemsAffected} memory row(s)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Two-way memory link repair failed', { context: LOG_CONTEXT, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected,
        message: `Two-way memory link repair failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
