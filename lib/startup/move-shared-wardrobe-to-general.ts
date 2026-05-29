/**
 * Move Shared Wardrobe Archetypes into Quilltap General
 *
 * One-time startup task that completes the wardrobe vault cutover for *shared*
 * items. Character-owned wardrobe already lives in each character's vault; the
 * old `characterId = null` archetype rows in `wardrobe_items` had no vault, so
 * this task writes each into the singleton "Quilltap General" mount under a
 * `Wardrobe/` folder (the same `Wardrobe/*.md` frontmatter format) and then
 * deletes the moved DB rows.
 *
 * Why a startup task and not a migration: migrations run in Phase 1, before the
 * mount-index database is initialised, so `writeDatabaseDocument` throws "Mount
 * index database not initialized" there. This runs in Phase 3.2 (chained after
 * `refreshVaultWardrobe`), where vault writes work — the same place character
 * wardrobe is projected.
 *
 * Idempotent via the `shared_wardrobe_moved_to_general_v1` flag in
 * `instance_settings`: runs once per database, then no-ops. If the General mount
 * isn't provisioned yet, or some writes fail, the flag is left unset so the next
 * startup retries rather than recording a half-done move.
 *
 * @module startup/move-shared-wardrobe-to-general
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { ensureGeneralWardrobeFolder } from '@/lib/mount-index/general-wardrobe';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import {
  buildWardrobeItemFile,
  buildSlugByItemIdMap,
  sanitizeFileName,
} from '@/lib/mount-index/character-vault';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

const logger = createServiceLogger('Startup:MoveSharedWardrobe');

const FLAG_KEY = 'shared_wardrobe_moved_to_general_v1';
const GENERAL_WARDROBE_FOLDER = 'Wardrobe';

interface ArchetypeRow {
  id: string;
  title: string;
  description: string | null;
  types: string | null;
  componentItemIds: string | null;
  appropriateness: string | null;
  isDefault: number | null;
  migratedFromClothingRecordId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MoveSharedWardrobeResult {
  moved: number;
  deleted: number;
  skipped: boolean;
  alreadyDone: boolean;
}

function rowToWardrobeItem(row: ArchetypeRow): WardrobeItem {
  let types: WardrobeItem['types'];
  try {
    types = JSON.parse(row.types || '[]');
  } catch {
    types = [];
  }
  let componentItemIds: string[] = [];
  if (row.componentItemIds) {
    try {
      const parsed = JSON.parse(row.componentItemIds);
      if (Array.isArray(parsed)) componentItemIds = parsed.filter((v) => typeof v === 'string');
    } catch {
      componentItemIds = [];
    }
  }
  return {
    id: row.id,
    characterId: null,
    title: row.title,
    description: row.description ?? null,
    types,
    componentItemIds,
    appropriateness: row.appropriateness ?? null,
    isDefault: row.isDefault === 1,
    // The wardrobe_items table never had a `replace` column — archetypes
    // default to additive, matching the new composite default.
    replace: false,
    migratedFromClothingRecordId: row.migratedFromClothingRecordId ?? null,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function moveSharedWardrobeToGeneral(): Promise<MoveSharedWardrobeResult> {
  const result: MoveSharedWardrobeResult = {
    moved: 0,
    deleted: 0,
    skipped: false,
    alreadyDone: false,
  };

  if (hasRun()) {
    result.alreadyDone = true;
    return result;
  }

  const db = getRawDatabase();
  if (!db) {
    result.skipped = true;
    return result;
  }

  // No wardrobe_items table (fresh install never had archetypes) → mark done.
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='wardrobe_items'`)
    .get();
  if (!tableExists) {
    markRun();
    result.alreadyDone = true;
    return result;
  }

  const rows = db
    .prepare(
      `SELECT "id", "title", "description", "types", "componentItemIds",
              "appropriateness", "isDefault", "migratedFromClothingRecordId",
              "archivedAt", "createdAt", "updatedAt"
       FROM "wardrobe_items" WHERE "characterId" IS NULL`,
    )
    .all() as ArchetypeRow[];

  if (rows.length === 0) {
    // Nothing shared to move — done forever.
    markRun();
    result.alreadyDone = true;
    return result;
  }

  const generalMountPointId = await getGeneralMountPointId();
  if (!generalMountPointId) {
    // Provisioning migration hasn't run yet — defer (don't set the flag).
    logger.warn('Quilltap General mount not provisioned yet; deferring shared-wardrobe move', {
      shared: rows.length,
    });
    result.skipped = true;
    return result;
  }

  await ensureGeneralWardrobeFolder();

  const archetypes = rows.map(rowToWardrobeItem);
  const slugByItemId = buildSlugByItemIdMap(archetypes);

  logger.info('Moving shared wardrobe archetypes into Quilltap General', {
    count: archetypes.length,
    generalMountPointId,
  });

  // Write each archetype as Quilltap General/Wardrobe/<slug>.md, deduping
  // filename collisions. writeDatabaseDocument creates the folder on first write.
  const seenFileNames = new Set<string>();
  const movedIds: string[] = [];
  for (const item of archetypes) {
    const baseName = `${sanitizeFileName(item.title)}.md`;
    let candidate = baseName;
    let n = 1;
    while (seenFileNames.has(candidate.toLowerCase())) {
      const dot = baseName.lastIndexOf('.');
      const base = dot >= 0 ? baseName.slice(0, dot) : baseName;
      const ext = dot >= 0 ? baseName.slice(dot) : '';
      candidate = `${base}-${n}${ext}`;
      n++;
    }
    seenFileNames.add(candidate.toLowerCase());

    try {
      await writeDatabaseDocument(
        generalMountPointId,
        `${GENERAL_WARDROBE_FOLDER}/${candidate}`,
        buildWardrobeItemFile(item, slugByItemId),
      );
      movedIds.push(item.id);
    } catch (err) {
      logger.error('Failed to write shared wardrobe item into Quilltap General', {
        itemId: item.id,
        title: item.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  result.moved = movedIds.length;

  // Delete the rows we successfully wrote.
  if (movedIds.length > 0) {
    const stmt = db.prepare(`DELETE FROM "wardrobe_items" WHERE "id" = ?`);
    const tx = db.transaction((ids: string[]) => {
      for (const id of ids) result.deleted += stmt.run(id).changes;
    });
    tx(movedIds);
  }

  // Only mark complete if everything moved; otherwise retry stragglers next boot.
  if (movedIds.length === archetypes.length) {
    markRun();
  } else {
    logger.warn('Some shared wardrobe items could not be moved; will retry next startup', {
      moved: movedIds.length,
      total: archetypes.length,
    });
  }

  logger.info('Shared wardrobe move complete', result);
  return result;
}

function hasRun(): boolean {
  const db = getRawDatabase();
  if (!db) return false;
  try {
    const row = db
      .prepare(`SELECT "value" FROM "instance_settings" WHERE "key" = ?`)
      .get(FLAG_KEY) as { value: string } | undefined;
    return row?.value === 'true';
  } catch {
    return false;
  }
}

function markRun(): void {
  const db = getRawDatabase();
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?)
       ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`,
    ).run(FLAG_KEY, 'true');
  } catch (err) {
    logger.warn('Failed to record shared-wardrobe move flag', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
