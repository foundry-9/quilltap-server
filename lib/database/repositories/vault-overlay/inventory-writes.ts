/**
 * Inventory writes — the one place an Inventory object reaches disk.
 *
 * Every tier's objects are `.json` files under an `Inventory/` folder in some
 * mount (a character's vault, a group store, a project store, Quilltap
 * General). Each mutation reads the folder's records, applies the change in
 * memory and re-projects the whole folder through
 * `projectArrayIntoVaultFolder` (`.json`, recursive, `images/` excluded,
 * sweeping only the files the folder's scan parsed into records), serialised
 * per folder; each write parses the folder once. The folder operations are the wardrobe's, through the shared
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
  readInventoryRecords,
  scanInventoryFolder,
  type InventoryFolderScan,
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
import { withInventoryWritesLinted } from '@/lib/inventory/lint-scope';

/** An Inventory tier's folder on disk. */
export type InventoryMount = VaultFolderMount;

/**
 * Serialised per folder, and marked as linted: every write here comes from
 * the Inventory mutations, which have already run the title lint, so the
 * document-write layer leaves these alone (`lib/inventory/lint-scope.ts`).
 */
function runSerialized<T>(mountPointId: string, fn: () => Promise<T>): Promise<T> {
  return runSerializedOnKey(chainKey(INVENTORY_FOLDER_RULES, mountPointId), () => withInventoryWritesLinted(fn));
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
 * Re-project the folder from an authoritative record list. Only the files
 * the scan turned into records are swept; a file it skipped (a duplicate id,
 * a note, a broken file) is not owned and stays where it is. A writer passes
 * the scan its records came from, so the folder is parsed once per write.
 */
async function projectMountInventory(
  mount: InventoryMount,
  records: readonly InventoryRecord[],
  scan?: InventoryFolderScan,
): Promise<void> {
  const { duplicatePaths, ownedPaths } = scan ?? (await scanInventoryFolder(mount.mountPointId));
  if (duplicatePaths.size > 0) {
    logger.debug('Inventory projection leaving duplicate-id files alone', {
      mountPointId: mount.mountPointId,
      paths: Array.from(duplicatePaths),
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
      ownsFile: (doc) => ownedPaths.has(doc.relativePath),
      // Claimed so no projected object is written over one.
      preserveFileNames: Array.from(duplicatePaths, (path) => path.slice(path.lastIndexOf('/') + 1)),
      ext: '.json',
    },
  );
}

/** Create a record in the folder. */
export async function createInventoryInMount(mount: InventoryMount, record: InventoryRecord): Promise<InventoryRecord> {
  return runSerialized(mount.mountPointId, async () => {
    const scan = await scanInventoryFolder(mount.mountPointId);
    const stored: InventoryRecord = { ...record, folder: safeFolder(record.folder) };
    await projectMountInventory(mount, [...scan.records, stored], scan);
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
 * Apply patches to a record list in memory: identity and `createdAt` are the
 * record's own, `updatedAt` is now, `remove` drops stored keys. Returns the
 * new list and the ids that matched, in patch order.
 */
function applyPatches(
  records: readonly InventoryRecord[],
  patches: readonly InventoryRecordPatch[],
): { next: InventoryRecord[]; updatedIds: string[]; indexById: Map<string, number> } {
  const indexById = new Map(records.map((record, idx) => [record.id, idx]));
  const next = records.slice();
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
  return { next, updatedIds, indexById };
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
  const scan = await scanInventoryFolder(mount.mountPointId);
  if (opts.requireAll) {
    const present = new Set(scan.records.map((record) => record.id));
    const missing = patches.map((p) => p.id).filter((id) => !present.has(id));
    if (missing.length > 0) throw new InventoryItemNotInLocationError(Array.from(new Set(missing)));
  }
  const { next, updatedIds, indexById } = applyPatches(scan.records, patches);
  if (updatedIds.length === 0) return [];
  await projectMountInventory(mount, next, scan);
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
    const scan = await scanInventoryFolder(mount.mountPointId);
    const current = scan.records;
    const deleted = current.filter((record) => doomed.has(record.id)).map((record) => record.id);
    if (deleted.length === 0) return [];
    const survivors = current.filter((record) => !doomed.has(record.id));
    const patches = followOn(survivors);
    const remaining = patches.length > 0 ? applyPatches(survivors, patches).next : survivors;
    await projectMountInventory(mount, remaining, scan);
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
  return withInventoryWritesLinted(() => createFolderIn(INVENTORY_TREE, mount, folder));
}

/** Rename a folder in place. */
export function renameInventoryFolderInMount(
  mount: InventoryMount,
  folder: string,
  newName: string,
): Promise<InventoryFolder> {
  return withInventoryWritesLinted(() => renameFolderIn(INVENTORY_TREE, mount, folder, newName));
}

/** Delete a folder, sending its objects and subfolders up to its parent. */
export function deleteInventoryFolderInMount(
  mount: InventoryMount,
  folder: string,
): Promise<{ movedItems: number; movedFolders: number; parent: string }> {
  return withInventoryWritesLinted(() => deleteFolderIn(INVENTORY_TREE, mount, folder));
}
