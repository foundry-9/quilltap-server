/**
 * Database Abstraction Layer - Wardrobe Wear Ledger Repository
 *
 * Backs `wardrobe_wear_stats`: per (wardrobe item × wearer) a wear count, the
 * first and last time it was worn, and the chat it was last worn in. Totals
 * are sums over wearers. There is no per-event log.
 *
 * The tally lives here rather than in the item's frontmatter because items are
 * vault files and every item write re-projects the whole `Wardrobe/` folder and
 * bumps `updatedAt` — a counter there would rewrite thirty files to count one
 * wear, make "last edited" mean "last worn", and be a read-modify-write the
 * job child cannot do (its reads are a stale snapshot, its writes buffered).
 * Here an increment is one atomic upsert.
 *
 * ## The chokepoint
 *
 * {@link WardrobeWearRepository.commitEquippedOutfit} is the one place a
 * character's equipped slots are written on a "put something on" path. It
 * writes the slots, diffs them against the true prior state, and credits a
 * wear to each leaf that went from not-worn to worn — plus each bundle the
 * caller says it dissolved, when at least one of that bundle's leaves
 * transitioned. Being a repository method, a call from the forked job child is
 * buffered whole and replayed in the parent (`METHOD_OVERRIDES` in
 * `lib/background-jobs/child/child-repositories-proxy.ts`), so the diff is
 * always taken against what the chat really holds at replay time, never the
 * child's stale snapshot. **Never call `incrementWears` from a handler** to
 * credit a wear by hand: the handler's idea of "already worn" is stale.
 *
 * Method names follow the child proxy's prefixes: reads start with `find`,
 * writes with `increment` / `delete` / `upsert`; `foldWearerIntoUnattributed`
 * and `commitEquippedOutfit` carry explicit overrides.
 *
 * Design of record: docs/developer/features/wardrobe-wear-ledger.md
 */

import { randomUUID } from 'node:crypto';
import { AbstractBaseRepository, type CreateOptions } from './base.repository';
import { rawQuery } from '../manager';
import { logger } from '@/lib/logger';
import { chunkArray, SQLITE_VARIABLE_CHUNK_SIZE } from '@/lib/utils/chunk';
import {
  WARDROBE_WEAR_INCREMENT_SQL,
  WARDROBE_WEAR_STATS_TABLE,
  wardrobeWearIncrementParams,
} from '../backends/sqlite/wardrobe-wear-stats-ddl';
import {
  WardrobeWearStatsRowSchema,
  neverWornSummary,
  type WardrobeWearHistory,
  type WardrobeWearStatsRow,
  type WardrobeWearSummary,
  type WardrobeWearer,
} from '@/lib/schemas/wardrobe-wear.types';
import { allEquippedItemIds } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';

const log = logger.child({ module: 'wardrobe-wear' });

/** Where a put-on gesture came from. Recorded in the log; `'merge'` never credits. */
export type EquipSource =
  | 'ui'                // Wardrobe dialog set_all / wear / replace / add_to_slot
  | 'tool'              // wardrobe_wear, wardrobe_create equip_now
  | 'chat-start'        // applyOutfitSelections for a new chat
  | 'participant-added' // applyOutfitSelections for an added/reactivated seat
  | 'merge'             // applyOutfitSelections from a merge (never counts)
  | 'take-off';         // removeFromSlot; nothing can be newly worn, kept for the log line

export interface CommitEquippedOutfitInput {
  chatId: string;
  characterId: string;
  nextSlots: EquippedSlots;
  /** Bundles the caller dissolved into nextSlots, with the leaves each contributed. */
  wornBundles?: Array<{ id: string; leafIds: string[] }>;
  source: EquipSource;
  /** ISO timestamp; defaults to now at execution time. */
  at?: string;
}

export interface CommitEquippedOutfitResult {
  slots: EquippedSlots;
  newlyWornLeafIds: string[];
  creditedBundleIds: string[];
  changed: boolean;
}

export interface WardrobeWearIncrement {
  itemId: string;
  wearerCharacterId: string;
  chatId: string;
  at: string;
}

/** The slice of the chats repository the chokepoint writes through. */
export interface EquippedOutfitStore {
  getEquippedOutfitForCharacter(chatId: string, characterId: string): Promise<EquippedSlots | null>;
  setEquippedOutfit(chatId: string, characterId: string, slots: EquippedSlots): Promise<EquippedSlots | null>;
}

/**
 * The pure half of the chokepoint: which leaves went on, which bundles earn a
 * wear, and whether anything changed at all. Exported for tests.
 */
export function diffEquippedOutfit(
  prior: EquippedSlots | null,
  next: EquippedSlots,
  wornBundles: ReadonlyArray<{ id: string; leafIds: readonly string[] }> = [],
): { newlyWornLeafIds: string[]; creditedBundleIds: string[]; changed: boolean } {
  const before = new Set(prior ? allEquippedItemIds(prior) : []);
  const after = allEquippedItemIds(next);
  const newlyWorn = after.filter((id) => !before.has(id));
  const newlyWornSet = new Set(newlyWorn);

  const creditedBundleIds: string[] = [];
  for (const bundle of wornBundles) {
    if (creditedBundleIds.includes(bundle.id)) continue;
    // A bundle that is itself sitting in the slots (stored whole, a legacy
    // row) is already counted by the leaf diff above.
    if (newlyWornSet.has(bundle.id)) continue;
    if (bundle.leafIds.some((leafId) => newlyWornSet.has(leafId))) {
      creditedBundleIds.push(bundle.id);
    }
  }

  return {
    newlyWornLeafIds: newlyWorn,
    creditedBundleIds,
    changed: !sameSlots(prior, next),
  };
}

function sameSlots(a: EquippedSlots | null, b: EquippedSlots): boolean {
  if (!a) return allEquippedItemIds(b).length === 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof EquippedSlots>;
  for (const key of keys) {
    const left = a[key] ?? [];
    const right = b[key] ?? [];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
  }
  return true;
}

/** Fold per-wearer rows into an item's totals. */
function summarize(rows: ReadonlyArray<Pick<WardrobeWearStatsRow, 'wearCount' | 'firstWornAt' | 'lastWornAt' | 'lastWornChatId'>>): WardrobeWearSummary {
  const summary = neverWornSummary();
  for (const row of rows) {
    if (row.wearCount <= 0) continue;
    summary.wearCount += row.wearCount;
    if (!summary.firstWornAt || row.firstWornAt < summary.firstWornAt) {
      summary.firstWornAt = row.firstWornAt;
    }
    if (!summary.lastWornAt || row.lastWornAt > summary.lastWornAt) {
      summary.lastWornAt = row.lastWornAt;
      summary.lastWornChatId = row.lastWornChatId;
    }
  }
  return summary;
}

type RawRow = Omit<WardrobeWearStatsRow, 'wearCount'> & { wearCount: number | bigint };

function normalizeRow(row: RawRow): WardrobeWearStatsRow {
  return { ...row, wearCount: Number(row.wearCount) };
}

export class WardrobeWearRepository extends AbstractBaseRepository<WardrobeWearStatsRow> {
  /**
   * @param chats The equipped-outfit store the chokepoint writes through —
   *   the container's own `ChatsRepository`.
   */
  constructor(private readonly chats?: EquippedOutfitStore) {
    super(WARDROBE_WEAR_STATS_TABLE, WardrobeWearStatsRowSchema);
  }

  // ============================================================================
  // Abstract method implementations (generic CRUD; prefer the ledger methods)
  // ============================================================================

  async create(
    data: Omit<WardrobeWearStatsRow, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions,
  ): Promise<WardrobeWearStatsRow> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<WardrobeWearStatsRow>): Promise<WardrobeWearStatsRow | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // The chokepoint
  // ============================================================================

  /**
   * Write a character's equipped slots in a chat and credit the wears the
   * write represents. See the module doc.
   *
   * The slots are written even when they equal the prior state, so the
   * callers' announcement and avatar hooks behave exactly as before. From the
   * job child this call is buffered and its return value is synthetic —
   * callers must not branch on it.
   *
   * No explicit transaction: the read, the write and the increments run back
   * to back with no yield to another request in between (the SQLite calls are
   * synchronous under their async wrappers), and a child's replay already runs
   * inside the applier's `BEGIN IMMEDIATE` — opening a second one there would
   * throw. Each increment is itself a single atomic statement.
   */
  async commitEquippedOutfit(input: CommitEquippedOutfitInput): Promise<CommitEquippedOutfitResult> {
    const { chatId, characterId, nextSlots, source } = input;
    if (!this.chats) {
      throw new Error('WardrobeWearRepository.commitEquippedOutfit needs a chats store');
    }

    const prior = await this.chats.getEquippedOutfitForCharacter(chatId, characterId);
    const written = await this.chats.setEquippedOutfit(chatId, characterId, nextSlots);
    const slots = written ?? nextSlots;

    const { newlyWornLeafIds, creditedBundleIds, changed } = diffEquippedOutfit(
      prior,
      nextSlots,
      input.wornBundles ?? [],
    );

    const credit = source === 'merge' ? [] : [...newlyWornLeafIds, ...creditedBundleIds];
    if (written && credit.length > 0) {
      const at = input.at ?? new Date().toISOString();
      await this.incrementWears(
        credit.map((itemId) => ({ itemId, wearerCharacterId: characterId, chatId, at })),
      );
    }

    log.debug('Committed equipped outfit', {
      chatId,
      characterId,
      source,
      newlyWorn: newlyWornLeafIds.length,
      creditedBundles: creditedBundleIds.length,
      credited: written ? credit.length : 0,
      changed,
      written: !!written,
    });

    return { slots, newlyWornLeafIds, creditedBundleIds, changed };
  }

  // ============================================================================
  // Writes
  // ============================================================================

  /** Atomic upsert-and-increment, one statement per entry. Safe to replay from a job child. */
  async incrementWears(entries: WardrobeWearIncrement[]): Promise<void> {
    if (entries.length === 0) return;
    const now = new Date().toISOString();
    for (const entry of entries) {
      await rawQuery(
        WARDROBE_WEAR_INCREMENT_SQL,
        wardrobeWearIncrementParams({
          id: randomUUID(),
          itemId: entry.itemId,
          wearerCharacterId: entry.wearerCharacterId,
          at: entry.at,
          chatId: entry.chatId,
          now,
        }),
      );
    }
  }

  /** Item deleted: drop its rows. A composite's deletion leaves its components' rows alone. */
  async deleteByItemIds(itemIds: string[]): Promise<void> {
    const ids = Array.from(new Set(itemIds.filter(Boolean)));
    if (ids.length === 0) return;
    for (const chunk of chunkArray(ids, SQLITE_VARIABLE_CHUNK_SIZE)) {
      await rawQuery(
        `DELETE FROM "${WARDROBE_WEAR_STATS_TABLE}" WHERE "itemId" IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      );
    }
    log.debug('Dropped wear ledger rows for deleted items', { itemCount: ids.length });
  }

  /**
   * Character deleted: fold each of their rows into the item's unattributed
   * row (counts summed, earliest first wear, latest last wear and its chat),
   * then delete theirs. Totals survive; attribution does not. A fold rather
   * than `SET NULL` because the unique index admits one unattributed row per
   * item.
   */
  async foldWearerIntoUnattributed(characterId: string): Promise<void> {
    const rows = await this.findRowsForWearer(characterId);
    if (rows.length === 0) return;

    const now = new Date().toISOString();
    for (const row of rows) {
      await rawQuery(
        `INSERT INTO "${WARDROBE_WEAR_STATS_TABLE}"
           ("id", "itemId", "wearerCharacterId", "wearCount", "firstWornAt", "lastWornAt", "lastWornChatId", "createdAt", "updatedAt")
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
         ON CONFLICT ("itemId", COALESCE("wearerCharacterId", '')) DO UPDATE SET
           "wearCount" = "wearCount" + excluded."wearCount",
           "firstWornAt" = MIN("firstWornAt", excluded."firstWornAt"),
           "lastWornChatId" = CASE WHEN excluded."lastWornAt" >= "lastWornAt" THEN excluded."lastWornChatId" ELSE "lastWornChatId" END,
           "lastWornAt" = MAX("lastWornAt", excluded."lastWornAt"),
           "updatedAt" = excluded."updatedAt"`,
        [randomUUID(), row.itemId, row.wearCount, row.firstWornAt, row.lastWornAt, row.lastWornChatId, now, now],
      );
    }
    await rawQuery(
      `DELETE FROM "${WARDROBE_WEAR_STATS_TABLE}" WHERE "wearerCharacterId" = ?`,
      [characterId],
    );

    log.info('Folded a departed wearer into the unattributed wear ledger', {
      characterId,
      rowCount: rows.length,
    });
  }

  /**
   * Import/restore: write rows as given — no increment. A row colliding with
   * an existing (item × wearer) row replaces its tally. Callers that may hand
   * over two rows for the same key (an import folding several unknown wearers
   * into "unattributed") must merge them first.
   */
  async upsertRows(rows: WardrobeWearStatsRow[]): Promise<void> {
    if (rows.length === 0) return;
    for (const row of rows) {
      await rawQuery(
        `INSERT INTO "${WARDROBE_WEAR_STATS_TABLE}"
           ("id", "itemId", "wearerCharacterId", "wearCount", "firstWornAt", "lastWornAt", "lastWornChatId", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT ("itemId", COALESCE("wearerCharacterId", '')) DO UPDATE SET
           "wearCount" = excluded."wearCount",
           "firstWornAt" = excluded."firstWornAt",
           "lastWornAt" = excluded."lastWornAt",
           "lastWornChatId" = excluded."lastWornChatId",
           "updatedAt" = excluded."updatedAt"`,
        [
          row.id,
          row.itemId,
          row.wearerCharacterId,
          row.wearCount,
          row.firstWornAt,
          row.lastWornAt,
          row.lastWornChatId,
          row.createdAt,
          row.updatedAt,
        ],
      );
    }
    log.debug('Upserted wear ledger rows', { rowCount: rows.length });
  }

  // ============================================================================
  // Reads
  // ============================================================================

  /**
   * Totals for a list of items, for list views. Every requested id is in the
   * map; one never worn maps to the zero summary.
   */
  async findSummaries(itemIds: string[]): Promise<Map<string, WardrobeWearSummary>> {
    const ids = Array.from(new Set(itemIds.filter(Boolean)));
    const result = new Map<string, WardrobeWearSummary>(ids.map((id) => [id, neverWornSummary()]));
    if (ids.length === 0) return result;

    return this.safeQuery(
      async () => {
        const rowsByItem = new Map<string, WardrobeWearStatsRow[]>();
        for (const row of await this.findRowsForItems(ids)) {
          const list = rowsByItem.get(row.itemId) ?? [];
          list.push(row);
          rowsByItem.set(row.itemId, list);
        }
        for (const [itemId, rows] of rowsByItem) {
          result.set(itemId, summarize(rows));
        }
        return result;
      },
      'Error reading wear summaries',
      { itemCount: ids.length },
      result,
    );
  }

  /** Totals plus the per-wearer rows (most recent first), for the editor and `wardrobe_read`. */
  async findHistory(itemId: string): Promise<WardrobeWearHistory> {
    const empty: WardrobeWearHistory = { ...neverWornSummary(), wearers: [] };
    return this.safeQuery(
      async () => {
        const rows = (await this.findRowsForItems([itemId])).filter((r) => r.wearCount > 0);
        if (rows.length === 0) return empty;
        const wearers: WardrobeWearer[] = rows
          .map((row) => ({
            characterId: row.wearerCharacterId,
            wearCount: row.wearCount,
            firstWornAt: row.firstWornAt,
            lastWornAt: row.lastWornAt,
            lastWornChatId: row.lastWornChatId,
          }))
          .sort((a, b) => (a.lastWornAt < b.lastWornAt ? 1 : a.lastWornAt > b.lastWornAt ? -1 : 0));
        return { ...summarize(rows), wearers };
      },
      'Error reading wear history',
      { itemId },
      empty,
    );
  }

  /** Every ledger row for these items (export). */
  async findRowsForItems(itemIds: string[]): Promise<WardrobeWearStatsRow[]> {
    const ids = Array.from(new Set(itemIds.filter(Boolean)));
    if (ids.length === 0) return [];
    const rows: WardrobeWearStatsRow[] = [];
    for (const chunk of chunkArray(ids, SQLITE_VARIABLE_CHUNK_SIZE)) {
      const found = await rawQuery<RawRow[]>(
        `SELECT * FROM "${WARDROBE_WEAR_STATS_TABLE}" WHERE "itemId" IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      );
      for (const row of found) rows.push(normalizeRow(row));
    }
    return rows;
  }

  /** Every ledger row one character holds. */
  async findRowsForWearer(characterId: string): Promise<WardrobeWearStatsRow[]> {
    const found = await rawQuery<RawRow[]>(
      `SELECT * FROM "${WARDROBE_WEAR_STATS_TABLE}" WHERE "wearerCharacterId" = ?`,
      [characterId],
    );
    return found.map(normalizeRow);
  }
}
