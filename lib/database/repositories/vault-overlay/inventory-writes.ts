/**
 * Inventory writes — the one place an Inventory object reaches disk.
 *
 * Every tier's objects are `.json` files under an `Inventory/` folder in some
 * mount (a character's vault, a group store, a project store, Quilltap
 * General). Each mutation reads the folder's records, applies the change in
 * memory and re-projects the whole folder through
 * `projectArrayIntoVaultFolder` (`.json`, recursive, `images/` excluded,
 * sweeping only files {@link isInventoryItemDocument} owns), serialised per
 * folder. The folder operations are the wardrobe's, through the shared
 * `item-folder-ops.ts` descriptor.
 *
 * Records are stored as read: an instance's file stays sparse. Callers reach
 * this through `resolveInventoryLocation` (`lib/inventory/location.ts`).
 *
 * @module database/repositories/vault-overlay/inventory-writes
 */

import { logger } from '@/lib/logger';
import {
  INVENTORY_FOLDER,
  INVENTORY_FOLDER_RULES,
  INVENTORY_RESERVED_FOLDER_SEGMENTS,
  InventoryFolderConflictError,
  InventoryFolderNotFoundError,
  InventoryFolderPathError,
  InventoryItemNotInLocationError,
  isSafeInventoryFolderPath,
  joinFolder,
  normalizeInventoryFolderPathOrRoot,
  type InventoryFolder,
} from '@/lib/inventory/folders';
import { sanitizeFileName } from '@/lib/mount-index/sanitize-file-name';
import { INVENTORY_FILE_KEYS, type InventoryRecord } from '@/lib/schemas/inventory.types';
import {
  hasStableInventoryItemId,
  inventoryFileNameFor,
  isInventoryItemDocument,
  readDuplicateInventoryPaths,
  readInventoryRecords,
} from './inventory-readers';
import {
  chainKey,
  createFolderIn,
  deleteFolderIn,
  listFolderPathsIn,
  listFoldersIn,
  renameFolderIn,
  resolveVaultFolderMount,
  runSerialized as runSerializedOnKey,
  type ItemFolderTree,
  type VaultFolderMount,
} from './item-folder-ops';
import { projectArrayIntoVaultFolder } from './vault-projection';

/** An Inventory tier's folder on disk. */
export type InventoryMount = VaultFolderMount;

function runSerialized<T>(mountPointId: string, fn: () => Promise<T>): Promise<T> {
  return runSerializedOnKey(chainKey(INVENTORY_FOLDER_RULES, mountPointId), fn);
}

/**
 * Resolve the Inventory folder's mount for a character id, or Quilltap
 * General for `null`. Throws `CharacterArchivedError` for an archived
 * character (the tombstone). A delegate over `resolveVaultFolderMount`.
 */
export function resolveInventoryMount(characterId: string | null | undefined): Promise<InventoryMount | null> {
  return resolveVaultFolderMount(characterId);
}

/** Every record in the folder, archived included. */
export function readMountInventory(mount: InventoryMount): Promise<InventoryRecord[]> {
  return readInventoryRecords(mount.mountPointId);
}

/** The file a record serialises to: known keys in schema order, `folder` and `fileStem` left out. */
export function serializeInventoryRecord(record: InventoryRecord): string {
  const out: Record<string, unknown> = {};
  const source = record as unknown as Record<string, unknown>;
  for (const key of INVENTORY_FILE_KEYS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}


/** The folder a record is written to (see the wardrobe's `safeFolder`). */
function safeFolder(folder: string | null | undefined): string {
  if (!folder) return '';
  if (isSafeInventoryFolderPath(folder)) return folder;
  const normalised = normalizeInventoryFolderPathOrRoot(folder);
  logger.debug('Inventory write normalised an incoming folder', { folder, normalised, context: 'inventory' });
  return normalised;
}

/**
 * Re-project the folder from an authoritative record list. A file the reader
 * skipped as a duplicate id is not owned, so the sweep leaves it in place.
 */
async function projectMountInventory(mount: InventoryMount, records: readonly InventoryRecord[]): Promise<void> {
  const duplicates = await readDuplicateInventoryPaths(mount.mountPointId);
  if (duplicates.size > 0) {
    logger.debug('Inventory projection leaving duplicate-id files alone', {
      mountPointId: mount.mountPointId,
      paths: Array.from(duplicates),
      context: 'inventory',
    });
  }
  await projectArrayIntoVaultFolder(
    mount.mountPointId,
    INVENTORY_FOLDER,
    records,
    (record) => ({ fileName: inventoryFileNameFor(record), content: serializeInventoryRecord(record) }),
    mount.characterId ?? mount.mountPointId,
    {
      recursive: { excludeSubfolders: INVENTORY_RESERVED_FOLDER_SEGMENTS },
      ownsFile: (doc) => !duplicates.has(doc.relativePath) && isInventoryItemDocument(doc),
      // Claimed so no projected object is written over one.
      preserveFileNames: Array.from(duplicates, (path) => path.slice(path.lastIndexOf('/') + 1)),
      ext: '.json',
    },
  );
}

/** Create a record in the folder. */
export async function createInventoryInMount(mount: InventoryMount, record: InventoryRecord): Promise<InventoryRecord> {
  return runSerialized(mount.mountPointId, async () => {
    const current = await readMountInventory(mount);
    const stored: InventoryRecord = { ...record, folder: safeFolder(record.folder) };
    await projectMountInventory(mount, [...current, stored]);
    logger.debug('Inventory object created in folder', {
      scope: mount.scope,
      mountPointId: mount.mountPointId,
      itemId: stored.id,
      folder: stored.folder,
      op: 'create',
      context: 'inventory',
    });
    return stored;
  });
}

/**
 * One record's change in an {@link updateInventoryManyInMount} batch: fields
 * to set, and stored keys to remove (an instance's override cleared).
 */
export interface InventoryRecordPatch {
  id: string;
  patch: Partial<InventoryRecord>;
  remove?: readonly string[];
}

/**
 * Patch several records with one read and one projection; the updated
 * records in patch order. A missing id is skipped, or with `requireAll`
 * refuses the batch before anything is written.
 */
export async function updateInventoryManyInMount(
  mount: InventoryMount,
  patches: readonly InventoryRecordPatch[],
  opts: { requireAll?: boolean } = {},
): Promise<InventoryRecord[]> {
  if (patches.length === 0) return [];
  return runSerialized(mount.mountPointId, () => updateManyUnserialized(mount, patches, opts));
}

async function updateManyUnserialized(
  mount: InventoryMount,
  patches: readonly InventoryRecordPatch[],
  opts: { requireAll?: boolean } = {},
): Promise<InventoryRecord[]> {
  const current = await readMountInventory(mount);
  const indexById = new Map(current.map((record, idx) => [record.id, idx]));
  if (opts.requireAll) {
    const missing = patches.map((p) => p.id).filter((id) => !indexById.has(id));
    if (missing.length > 0) throw new InventoryItemNotInLocationError(Array.from(new Set(missing)));
  }
  const next = current.slice();
  const now = new Date().toISOString();
  const updatedIds: string[] = [];
  for (const { id, patch, remove } of patches) {
    const idx = indexById.get(id);
    if (idx === undefined) continue;
    const before = next[idx];
    const merged: Record<string, unknown> = {
      ...before,
      ...patch,
      ...(patch.folder !== undefined && { folder: safeFolder(patch.folder) }),
      id: before.id,
      createdAt: before.createdAt,
      updatedAt: now,
    };
    for (const key of remove ?? []) delete merged[key];
    next[idx] = merged as InventoryRecord;
    updatedIds.push(id);
  }
  if (updatedIds.length === 0) return [];
  await projectMountInventory(mount, next);
  logger.debug('Inventory objects updated in folder', {
    scope: mount.scope,
    mountPointId: mount.mountPointId,
    itemIds: updatedIds,
    count: updatedIds.length,
    op: 'update',
    context: 'inventory',
  });
  return updatedIds.map((id) => next[indexById.get(id) as number]);
}

/**
 * Delete records from the folder, and in the same projection apply any
 * follow-on patches (a deleted kit member dropped from the kits that named
 * it). Returns the ids actually deleted.
 */
export async function deleteInventoryInMount(
  mount: InventoryMount,
  ids: readonly string[],
  followOn: (remaining: InventoryRecord[]) => InventoryRecordPatch[] = () => [],
): Promise<string[]> {
  return runSerialized(mount.mountPointId, async () => {
    const doomed = new Set(ids);
    const current = await readMountInventory(mount);
    const deleted = current.filter((record) => doomed.has(record.id)).map((record) => record.id);
    if (deleted.length === 0) return [];
    let remaining = current.filter((record) => !doomed.has(record.id));
    const patches = followOn(remaining);
    if (patches.length > 0) {
      const byId = new Map(patches.map((p) => [p.id, p]));
      const now = new Date().toISOString();
      remaining = remaining.map((record) => {
        const p = byId.get(record.id);
        return p ? ({ ...record, ...p.patch, id: record.id, updatedAt: now } as InventoryRecord) : record;
      });
    }
    await projectMountInventory(mount, remaining);
    logger.debug('Inventory objects deleted from folder', {
      scope: mount.scope,
      mountPointId: mount.mountPointId,
      itemIds: deleted,
      followOnPatches: patches.length,
      op: 'delete',
      context: 'inventory',
    });
    return deleted;
  });
}

// ============================================================================
// Folders — the shared folder operations over the Inventory's tree
// ============================================================================

const INVENTORY_TREE: ItemFolderTree<InventoryRecord> = {
  rules: INVENTORY_FOLDER_RULES,
  ext: '.json',
  context: 'inventory',
  isItemDocument: isInventoryItemDocument,
  hasStableId: hasStableInventoryItemId,
  read: readMountInventory,
  reproject: projectMountInventory,
  refile: (mount, patches) =>
    updateManyUnserialized(mount, patches.map(({ id, folder }) => ({ id, patch: { folder } }))),
  errors: {
    path: (message) => new InventoryFolderPathError(message),
    notFound: (folder) => new InventoryFolderNotFoundError(folder),
    conflict: (folder, message) => new InventoryFolderConflictError(folder, message),
  },
};

/** Every folder under the tier's `Inventory/`, with direct object counts. */
export function listInventoryFoldersInMount(mount: InventoryMount): Promise<InventoryFolder[]> {
  return listFoldersIn(INVENTORY_TREE, mount);
}

/** Every folder path under the tier's `Inventory/`, from the store's folder rows. */
export function listInventoryFolderPathsInMount(mount: InventoryMount): Promise<string[]> {
  return listFolderPathsIn(INVENTORY_TREE, mount);
}

/** Create a folder (normalised path); an existing one in any casing is answered. */
export function createInventoryFolderInMount(mount: InventoryMount, folder: string): Promise<InventoryFolder> {
  return createFolderIn(INVENTORY_TREE, mount, folder);
}

/** Rename a folder in place. */
export function renameInventoryFolderInMount(
  mount: InventoryMount,
  folder: string,
  newName: string,
): Promise<InventoryFolder> {
  return renameFolderIn(INVENTORY_TREE, mount, folder, newName);
}

/** Delete a folder, sending its objects and subfolders up to its parent. */
export function deleteInventoryFolderInMount(
  mount: InventoryMount,
  folder: string,
): Promise<{ movedItems: number; movedFolders: number; parent: string }> {
  return deleteFolderIn(INVENTORY_TREE, mount, folder);
}
