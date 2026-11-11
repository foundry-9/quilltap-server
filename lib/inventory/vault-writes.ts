/**
 * Inventory writes — the one place an Inventory object reaches disk.
 *
 * Every tier's objects are `.json` files under an `Inventory/` folder in some
 * mount (a character's vault, a group store, a project store, Quilltap
 * General). A binding of the item-store kernel (`createItemFolderStore`,
 * `lib/mount-index/item-store.ts`) with the Inventory's JSON serialiser, its
 * scan, and its title lint's mark: each mutation reads the folder, applies
 * the change in memory and re-projects it, serialised per folder, parsing the
 * folder once. The folder operations are the shared `item-folder-ops.ts` ones.
 *
 * Records are stored as read: an instance's file stays sparse. Callers reach
 * this through `resolveInventoryLocation` (`lib/inventory/location.ts`).
 *
 * @module lib/inventory/vault-writes
 */

import {
  INVENTORY_FOLDER_RULES,
  InventoryFolderConflictError,
  InventoryFolderNotFoundError,
  InventoryFolderPathError,
  InventoryItemNotInLocationError,
  type InventoryFolder,
} from '@/lib/inventory/folders';
import { INVENTORY_FILE_KEYS, type InventoryRecord } from '@/lib/schemas/inventory.types';
import {
  hasStableInventoryItemId,
  inventoryFileNameFor,
  isInventoryItemDocument,
  scanInventoryFolder,
} from '@/lib/inventory/vault-readers';
import type { VaultFolderMount } from '@/lib/mount-index/item-folder-ops';
import { createItemFolderStore, type ItemPatch } from '@/lib/mount-index/item-store';
import { withInventoryWritesLinted } from '@/lib/inventory/lint-scope';

/** An Inventory tier's folder on disk. */
export type InventoryMount = VaultFolderMount;

/**
 * One record's change in an {@link updateInventoryManyInMount} batch: fields
 * to set, and stored keys to remove (an instance's override cleared).
 */
export type InventoryRecordPatch = ItemPatch<InventoryRecord>;

/** The file a record serialises to: known keys in schema order, `folder` and `fileStem` left out. */
export function serializeInventoryRecord(record: InventoryRecord): string {
  const out: Record<string, unknown> = {};
  const source = record as unknown as Record<string, unknown>;
  for (const key of INVENTORY_FILE_KEYS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

const store = createItemFolderStore<InventoryRecord>({
  kind: 'inventory',
  rules: INVENTORY_FOLDER_RULES,
  ext: '.json',
  noun: { one: 'Inventory object', many: 'Inventory objects', idKey: 'itemId' },
  fileNameFor: inventoryFileNameFor,
  serialize: serializeInventoryRecord,
  scan: scanInventoryFolder,
  isItemDocument: isInventoryItemDocument,
  hasStableId: hasStableInventoryItemId,
  errors: {
    path: (message) => new InventoryFolderPathError(message),
    notFound: (folder) => new InventoryFolderNotFoundError(folder),
    conflict: (folder, message) => new InventoryFolderConflictError(folder, message),
    notInLocation: (ids) => new InventoryItemNotInLocationError(ids),
  },
  // Every write here comes from the Inventory mutations, which have already
  // run the title lint, so the document-write layer leaves these alone
  // (`lib/inventory/lint-scope.ts`).
  wrapWrite: withInventoryWritesLinted,
});

/**
 * Resolve the Inventory folder's mount for a character id, or Quilltap
 * General for `null`. Throws `CharacterArchivedError` for an archived
 * character (the tombstone).
 */
export const resolveInventoryMount: (characterId: string | null | undefined) => Promise<InventoryMount | null> =
  store.resolveMount;

/** Every record in the folder, archived included. */
export const readMountInventory: (mount: InventoryMount) => Promise<InventoryRecord[]> = store.read;

/** Create a record in the folder. */
export const createInventoryInMount = store.create;

/**
 * Patch several records with one read and one projection; the updated
 * records in patch order. A missing id is skipped, or with `requireAll`
 * refuses the batch before anything is written.
 */
export const updateInventoryManyInMount = store.updateMany;

/**
 * Delete records from the folder, and in the same projection apply any
 * follow-on patches (a deleted kit member dropped from the kits that named
 * it). Returns the ids actually deleted.
 */
export const deleteInventoryInMount = store.delete;

/** Every folder under the tier's `Inventory/`, with direct object counts. */
export const listInventoryFoldersInMount: (mount: InventoryMount) => Promise<InventoryFolder[]> = store.listFolders;

/** Every folder path under the tier's `Inventory/`, from the store's folder rows. */
export const listInventoryFolderPathsInMount = store.listFolderPaths;

/** Create a folder (normalised path); an existing one in any casing is answered. */
export const createInventoryFolderInMount = store.createFolder;

/** Rename a folder in place. */
export const renameInventoryFolderInMount = store.renameFolder;

/** Delete a folder, sending its objects and subfolders up to its parent. */
export const deleteInventoryFolderInMount = store.deleteFolder;
