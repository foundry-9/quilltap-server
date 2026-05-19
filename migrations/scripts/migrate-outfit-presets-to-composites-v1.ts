/**
 * Migration: Migrate Outfit Presets to Composite Wardrobe Items
 *
 * Folds rows from the legacy outfit_presets table into the wardrobe_items
 * table as composite items (items whose componentItemIds list points at
 * the slot UUIDs the preset originally referenced). The preset's UUID is
 * preserved so existing chat references, vault outfit-file ids, and exports
 * keep working unchanged.
 *
 * The outfit_presets table itself is dropped by a later migration
 * (drop-outfit-presets-table-v1).
 *
 * Migration ID: migrate-outfit-presets-to-composites-v1
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

interface OutfitPresetRow {
  id: string;
  characterId: string | null;
  name: string;
  description: string | null;
  slots: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Defensively read a slot value from a parsed slots object. The legacy
 * EquippedSlots shape allowed `string | null` per slot; we only use string
 * values here. Anything else (undefined, array, object) is treated as null.
 */
function readSlotValue(slots: unknown, slot: SlotName): string | null {
  if (!slots || typeof slots !== 'object') {
    return null;
  }
  const value = (slots as Record<string, unknown>)[slot];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export const migrateOutfitPresetsToCompositesMigration: Migration = {
  id: 'migrate-outfit-presets-to-composites-v1',
  description:
    'Migrate outfit_presets rows into composite wardrobe_items (componentItemIds)',
  introducedInVersion: '4.5.0',
  dependsOn: [
    'add-wardrobe-component-item-ids-v1',
    'create-outfit-presets-and-archive-v1',
  ],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('outfit_presets') || !sqliteTableExists('wardrobe_items')) {
      return false;
    }

    const wardrobeColumns = getSQLiteTableColumns('wardrobe_items').map((c) => c.name);
    if (!wardrobeColumns.includes('componentItemIds')) {
      return false;
    }

    const db = getSQLiteDatabase();
    const presetCount = db
      .prepare(`SELECT COUNT(*) AS count FROM outfit_presets`)
      .get() as { count: number };

    return presetCount.count > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let inserted = 0;
    let skipped = 0;
    let presetsRead = 0;

    try {
      const db = getSQLiteDatabase();

      logger.info('Starting outfit_presets to composite wardrobe_items migration', {
        context: 'migration.migrate-outfit-presets-to-composites',
      });

      const presets = db
        .prepare(
          `SELECT id, characterId, name, description, slots, createdAt, updatedAt FROM outfit_presets`
        )
        .all() as OutfitPresetRow[];
      presetsRead = presets.length;

      const existsStmt = db.prepare(
        `SELECT id FROM wardrobe_items WHERE id = ? LIMIT 1`
      );

      const insertStmt = db.prepare(`
        INSERT INTO wardrobe_items (
          id, characterId, title, description, types, appropriateness,
          isDefault, migratedFromClothingRecordId, archivedAt,
          componentItemIds, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, NULL, 0, NULL, NULL, ?, ?, ?)
      `);

      const insertAll = db.transaction(() => {
        for (const preset of presets) {
          // Skip if a wardrobe_items row with this ID already exists (idempotent re-run).
          const existing = existsStmt.get(preset.id) as { id: string } | undefined;
          if (existing) {
            skipped++;
            logger.debug('Skipping preset already present in wardrobe_items', {
              context: 'migration.migrate-outfit-presets-to-composites',
              presetId: preset.id,
            });
            continue;
          }

          let parsedSlots: unknown;
          try {
            parsedSlots = JSON.parse(preset.slots);
          } catch (err) {
            logger.warn('Failed to parse outfit_preset slots JSON; skipping row', {
              context: 'migration.migrate-outfit-presets-to-composites',
              presetId: preset.id,
              error: err instanceof Error ? err.message : String(err),
            });
            skipped++;
            continue;
          }

          // Walk slots in canonical order; collect (slotName, componentId) pairs
          // for slots that have a non-null UUID. Deduplicate componentIds (one
          // multi-slot wardrobe item may already cover several slots).
          const types: SlotName[] = [];
          const componentIds: string[] = [];
          const seenComponentIds = new Set<string>();

          for (const slot of SLOT_ORDER) {
            const componentId = readSlotValue(parsedSlots, slot);
            if (!componentId) {
              continue;
            }
            types.push(slot);
            if (!seenComponentIds.has(componentId)) {
              seenComponentIds.add(componentId);
              componentIds.push(componentId);
            }
          }

          insertStmt.run(
            preset.id,
            preset.characterId,
            preset.name,
            preset.description,
            JSON.stringify(types),
            JSON.stringify(componentIds),
            preset.createdAt,
            preset.updatedAt
          );
          inserted++;
          logger.debug('Migrated outfit_preset to composite wardrobe_item', {
            context: 'migration.migrate-outfit-presets-to-composites',
            presetId: preset.id,
            componentCount: componentIds.length,
            types,
          });
        }
      });

      insertAll();

      const durationMs = Date.now() - startTime;

      logger.info('Outfit presets to composites migration completed', {
        context: 'migration.migrate-outfit-presets-to-composites',
        presetsRead,
        inserted,
        skipped,
        durationMs,
      });

      return {
        id: 'migrate-outfit-presets-to-composites-v1',
        success: true,
        itemsAffected: inserted,
        message: `Migrated ${inserted} preset(s) to composite wardrobe_items (skipped ${skipped})`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to migrate outfit presets to composite wardrobe_items', {
        context: 'migration.migrate-outfit-presets-to-composites',
        error: errorMessage,
      });

      return {
        id: 'migrate-outfit-presets-to-composites-v1',
        success: false,
        itemsAffected: inserted,
        message: 'Failed to migrate outfit presets to composite wardrobe_items',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
