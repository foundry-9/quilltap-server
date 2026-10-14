/**
 * Migration: Seed the Wardrobe Wear Ledger
 *
 * Backfills `wardrobe_wear_stats` from what every chat's cast is wearing right
 * now, so an instance with a year of history does not open the ledger on
 * "never worn" across the board. For each chat, for each character in its
 * `equippedOutfit` map, for each item id across that character's slots: one
 * wear, dated by the chat's `updatedAt`, last worn in that chat. A second chat
 * wearing the same item adds a wear and moves "last worn" to the later date.
 *
 * Whole composite ids left in legacy rows are credited as themselves. Ids that
 * no longer resolve to an item produce orphan rows no list ever joins; nothing
 * prunes them and nothing needs to.
 *
 * Idempotent in effect only if run once — it is, by the migration ledger.
 *
 * Migration ID: seed-wardrobe-wear-stats-v1
 */

import { randomUUID } from 'node:crypto';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';
import {
  WARDROBE_WEAR_INCREMENT_SQL,
  wardrobeWearIncrementParams,
} from '@/lib/database/backends/sqlite/wardrobe-wear-stats-ddl';
import { allEquippedItemIds, normalizeEquippedSlots } from '@/lib/schemas/wardrobe.types';

const MIGRATION_ID = 'seed-wardrobe-wear-stats-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

interface ChatOutfitRow {
  id: string;
  updatedAt: string;
  equippedOutfit: string | null;
}

/**
 * The wears one chat contributes: one per (character × distinct item id).
 * Pure; exported for tests.
 */
export function wearsFromEquippedOutfit(
  rawOutfit: string | null,
): Array<{ characterId: string; itemId: string }> {
  if (!rawOutfit) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutfit);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

  const wears: Array<{ characterId: string; itemId: string }> = [];
  for (const [characterId, slots] of Object.entries(parsed as Record<string, unknown>)) {
    if (!characterId) continue;
    for (const itemId of allEquippedItemIds(normalizeEquippedSlots(slots))) {
      if (itemId) wears.push({ characterId, itemId });
    }
  }
  return wears;
}

export const seedWardrobeWearStatsMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Seed the wardrobe wear ledger from every chat\'s current equipped outfits',
  introducedInVersion: '4.10.0',
  dependsOn: ['add-wardrobe-wear-stats-table-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('wardrobe_wear_stats') || !sqliteTableExists('chats')) return false;
    const columns = getSQLiteTableColumns('chats').map((col) => col.name);
    return columns.includes('equippedOutfit') && columns.includes('updatedAt');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      // Read up front: better-sqlite3 cannot write on a connection mid-iterate,
      // and a chat row's outfit map is small.
      const chats = db
        .prepare(`SELECT "id", "updatedAt", "equippedOutfit" FROM "chats" WHERE "equippedOutfit" IS NOT NULL`)
        .all() as ChatOutfitRow[];
      const increment = db.prepare(WARDROBE_WEAR_INCREMENT_SQL);
      const now = new Date().toISOString();

      let scanned = 0;
      let wears = 0;
      let chatsWithOutfits = 0;

      // One synchronous transaction: the loading screen cannot update inside
      // it, but the progress lines still reach the log.
      db.transaction(() => {
        for (const chat of chats) {
          scanned += 1;
          const chatWears = wearsFromEquippedOutfit(chat.equippedOutfit);
          if (chatWears.length > 0) chatsWithOutfits += 1;
          for (const wear of chatWears) {
            increment.run(
              ...wardrobeWearIncrementParams({
                id: randomUUID(),
                itemId: wear.itemId,
                wearerCharacterId: wear.characterId,
                at: chat.updatedAt,
                chatId: chat.id,
                now,
              }),
            );
            wears += 1;
          }
          reportProgress(scanned, chats.length, 'chats');
        }
      })();

      logger.info('Seeded the wardrobe wear ledger from current outfits', {
        context: LOG_CONTEXT,
        chatsScanned: scanned,
        chatsWithOutfits,
        wearsCredited: wears,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: wears,
        message: `Credited ${wears} wear(s) across ${chatsWithOutfits} chat(s)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to seed the wardrobe wear ledger', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to seed the wardrobe wear ledger',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
