/**
 * Migration: Convert equippedOutfit Slots to Arrays
 *
 * The EquippedSlots shape changed: each slot value is now `UUID[]` instead
 * of `UUID | null`. This migration walks every chat with a non-null
 * equippedOutfit and rewrites it in place:
 *   - null            -> []
 *   - "<uuid>"        -> ["<uuid>"]
 *   - existing array  -> left alone (idempotent re-run)
 *
 * The `pendingOutfitNotifications` field is opaque metadata, NOT slot-shaped,
 * and is intentionally not touched.
 *
 * Migration ID: convert-equipped-outfit-to-arrays-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

const SLOT_ORDER = ['top', 'bottom', 'footwear', 'accessories'] as const;
type SlotName = (typeof SLOT_ORDER)[number];

interface ChatRow {
  id: string;
  equippedOutfit: string;
}

/**
 * Coerce a single slot value to its array form.
 *   null/undefined -> []
 *   string         -> [string]
 *   array          -> array (filtered to strings)
 *   anything else  -> []
 */
function coerceSlotToArray(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === 'string') {
    return value.length > 0 ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  return [];
}

export const convertEquippedOutfitToArraysMigration: Migration = {
  id: 'convert-equipped-outfit-to-arrays-v1',
  description:
    'Rewrite chats.equippedOutfit slot values from UUID|null to UUID[] form',
  introducedInVersion: '4.5.0',
  dependsOn: ['migrate-outfit-presets-to-composites-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats').map((c) => c.name);
    if (!columns.includes('equippedOutfit')) {
      return false;
    }

    const db = getSQLiteDatabase();
    const populated = db
      .prepare(
        `SELECT COUNT(*) AS count FROM chats WHERE equippedOutfit IS NOT NULL AND equippedOutfit != ''`
      )
      .get() as { count: number };

    return populated.count > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let chatsMigrated = 0;
    let chatsAlreadyMigrated = 0;
    let chatsScanned = 0;
    let chatsParseFailed = 0;

    try {
      const db = getSQLiteDatabase();

      logger.info('Starting equippedOutfit slot-to-array conversion', {
        context: 'migration.convert-equipped-outfit-to-arrays',
      });

      const chats = db
        .prepare(
          `SELECT id, equippedOutfit FROM chats WHERE equippedOutfit IS NOT NULL AND equippedOutfit != ''`
        )
        .all() as ChatRow[];
      chatsScanned = chats.length;

      const updateStmt = db.prepare(
        `UPDATE chats SET equippedOutfit = ? WHERE id = ?`
      );

      const updateAll = db.transaction(() => {
        for (const chat of chats) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(chat.equippedOutfit);
          } catch (err) {
            logger.warn('Failed to parse equippedOutfit JSON; skipping chat', {
              context: 'migration.convert-equipped-outfit-to-arrays',
              chatId: chat.id,
              error: err instanceof Error ? err.message : String(err),
            });
            chatsParseFailed++;
            continue;
          }

          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            logger.warn('equippedOutfit is not an object map; skipping chat', {
              context: 'migration.convert-equipped-outfit-to-arrays',
              chatId: chat.id,
            });
            continue;
          }

          const characterMap = parsed as Record<string, unknown>;
          const characterIds = Object.keys(characterMap);

          // Detect already-migrated shape: if any character entry's `top` slot
          // is already an array, treat the whole chat as already converted and
          // skip without rewriting.
          let alreadyMigrated = false;
          for (const characterId of characterIds) {
            const slots = characterMap[characterId];
            if (
              slots &&
              typeof slots === 'object' &&
              Array.isArray((slots as Record<string, unknown>).top)
            ) {
              alreadyMigrated = true;
              break;
            }
          }
          if (alreadyMigrated) {
            chatsAlreadyMigrated++;
            continue;
          }

          const next: Record<string, Record<SlotName, string[]>> = {};
          for (const characterId of characterIds) {
            const rawSlots = characterMap[characterId];
            const slotsObj =
              rawSlots && typeof rawSlots === 'object' && !Array.isArray(rawSlots)
                ? (rawSlots as Record<string, unknown>)
                : {};
            next[characterId] = {
              top: coerceSlotToArray(slotsObj.top),
              bottom: coerceSlotToArray(slotsObj.bottom),
              footwear: coerceSlotToArray(slotsObj.footwear),
              accessories: coerceSlotToArray(slotsObj.accessories),
            };
          }

          updateStmt.run(JSON.stringify(next), chat.id);
          chatsMigrated++;
        }
      });

      updateAll();

      const durationMs = Date.now() - startTime;

      logger.info('equippedOutfit slot-to-array conversion completed', {
        context: 'migration.convert-equipped-outfit-to-arrays',
        chatsScanned,
        chatsMigrated,
        chatsAlreadyMigrated,
        chatsParseFailed,
        durationMs,
      });

      return {
        id: 'convert-equipped-outfit-to-arrays-v1',
        success: true,
        itemsAffected: chatsMigrated,
        message: `Converted equippedOutfit on ${chatsMigrated} chat(s) (already-migrated: ${chatsAlreadyMigrated}, parse-failed: ${chatsParseFailed})`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to convert equippedOutfit slots to arrays', {
        context: 'migration.convert-equipped-outfit-to-arrays',
        error: errorMessage,
      });

      return {
        id: 'convert-equipped-outfit-to-arrays-v1',
        success: false,
        itemsAffected: chatsMigrated,
        message: 'Failed to convert equippedOutfit slots to arrays',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
