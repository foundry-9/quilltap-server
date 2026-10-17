/**
 * Migration: Seed the Chat Wardrobe History
 *
 * Gives every character already dressed in a chat an entry `0` — what they
 * have on right now — so the outfit record of an existing chat starts from the
 * present rather than from nothing. For each chat with a non-null
 * `equippedOutfit`, for each `(characterId, slots)` in it: one row,
 * `entryIndex 0`, current, source `'seeded'`, no actor, dated by the chat's
 * `updatedAt`. A pair that already has rows is skipped, so a re-run adds
 * nothing.
 *
 * A seat with no `equippedOutfit` key (never dressed) gets its `0` from the
 * runtime first-touch seed in `ChatWardrobeHistoryRepository.settle` instead.
 *
 * Migration ID: seed-chat-wardrobe-history-v1
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
  CHAT_WARDROBE_HISTORY_INSERT_SQL,
  CHAT_WARDROBE_HISTORY_TABLE,
} from '@/lib/database/backends/sqlite/chat-wardrobe-history-ddl';
import { normalizeEquippedSlots, type EquippedSlots } from '@/lib/schemas/wardrobe.types';
import { hashEquippedSlots } from '@/lib/wardrobe/outfit-hash';

const MIGRATION_ID = 'seed-chat-wardrobe-history-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

interface ChatOutfitRow {
  id: string;
  updatedAt: string;
  equippedOutfit: string | null;
}

/**
 * The (character, slots) pairs one chat's `equippedOutfit` map holds. Pure;
 * exported for tests.
 */
export function outfitsFromEquippedOutfit(
  rawOutfit: string | null,
): Array<{ characterId: string; slots: EquippedSlots }> {
  if (!rawOutfit) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutfit);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

  const outfits: Array<{ characterId: string; slots: EquippedSlots }> = [];
  for (const [characterId, slots] of Object.entries(parsed as Record<string, unknown>)) {
    if (!characterId) continue;
    outfits.push({ characterId, slots: normalizeEquippedSlots(slots) });
  }
  return outfits;
}

export const seedChatWardrobeHistoryMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Seed the chat wardrobe history with what every character has on now',
  introducedInVersion: '4.11.0',
  // The tool-name column first: the shared INSERT spells it.
  dependsOn: ['add-chat-wardrobe-history-table-v1', 'add-chat-wardrobe-history-tool-name-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists(CHAT_WARDROBE_HISTORY_TABLE) || !sqliteTableExists('chats')) return false;
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
      const hasRows = db.prepare(
        `SELECT 1 FROM "${CHAT_WARDROBE_HISTORY_TABLE}" WHERE "chatId" = ? AND "characterId" = ? LIMIT 1`,
      );
      const insert = db.prepare(CHAT_WARDROBE_HISTORY_INSERT_SQL);

      let seeded = 0;
      let skipped = 0;

      // One synchronous transaction: the loading screen cannot update inside
      // it, but the progress lines still reach the log.
      db.transaction(() => {
        chats.forEach((chat, i) => {
          for (const { characterId, slots } of outfitsFromEquippedOutfit(chat.equippedOutfit)) {
            if (hasRows.get(chat.id, characterId)) {
              skipped += 1;
              continue;
            }
            insert.run(
              randomUUID(),
              chat.id,
              characterId,
              0,
              JSON.stringify(slots),
              hashEquippedSlots(slots),
              'seeded',
              null,
              null,
              1,
              chat.updatedAt,
            );
            seeded += 1;
          }
          reportProgress(i + 1, chats.length, 'chats');
        });
      })();

      logger.info('Seeded the chat wardrobe history from current outfits', {
        context: LOG_CONTEXT,
        chatsScanned: chats.length,
        entriesSeeded: seeded,
        pairsSkipped: skipped,
      });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: seeded,
        message: `Seeded ${seeded} outfit record(s) across ${chats.length} chat(s)`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to seed the chat wardrobe history', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to seed the chat wardrobe history',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
