/**
 * Read a character's rows from the retired `wardrobe_items` table.
 *
 * Kept only for the two paths that project those rows into a vault before
 * `drop-wardrobe-items-table-v1` removes the table: the one-time startup
 * refresh (`lib/startup/refresh-vault-wardrobe.ts`) and the
 * `cutover-characters-to-vault` migration. Once the table is gone this reads
 * nothing. The wardrobe repository no longer knows the table exists.
 *
 * @module migrations/lib/legacy-wardrobe-rows
 */

import { getRawDatabase } from '../../lib/database/backends/sqlite/client';
import type { WardrobeItem, WardrobeItemType } from '../../lib/schemas/wardrobe.types';

interface LegacyWardrobeRow {
  id: string;
  characterId: string | null;
  title: string;
  description: string | null;
  types: string | null;
  componentItemIds?: string | null;
  appropriateness: string | null;
  isDefault: number | null;
  migratedFromClothingRecordId: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Every legacy row for the character (archived included), or `[]` once the table is gone. */
export function readLegacyWardrobeRows(characterId: string): WardrobeItem[] {
  const db = getRawDatabase();
  if (!db) return [];
  const table = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'wardrobe_items'`)
    .get();
  if (!table) return [];
  const rows = db
    .prepare(`SELECT * FROM "wardrobe_items" WHERE "characterId" = ?`)
    .all(characterId) as LegacyWardrobeRow[];
  return rows.map((row) => ({
    id: row.id,
    characterId: row.characterId,
    title: row.title,
    description: row.description ?? null,
    types: parseIdList(row.types) as WardrobeItemType[],
    componentItemIds: parseIdList(row.componentItemIds),
    appropriateness: row.appropriateness ?? null,
    isDefault: row.isDefault === 1,
    replace: false,
    migratedFromClothingRecordId: row.migratedFromClothingRecordId ?? null,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}
