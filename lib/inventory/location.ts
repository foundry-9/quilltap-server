/**
 * Inventory Location — the one answer to "where does this object live, and
 * how do I read and write there".
 *
 * A location is one tier's `Inventory/` folder: a character's vault, Quilltap
 * General, a project's official store or a group's official store. The same
 * surface as the wardrobe's location (`lib/wardrobe/location.ts`): records,
 * the record operations, the folder operations and the tombstone-checked
 * writable mount. Routes, transfers, pictures and equip address a tier
 * through this; nobody switches on scope to pick a writer.
 *
 * Every write through a location that changes something publishes the
 * `inventory` realtime topic once it lands, so an open Inventory dialog re-reads whoever made the change
 * (the operator in another window, a character's tool, Pascal). In the job
 * child the publish is a no-op and the commit hook names the topic instead
 * (`lib/realtime/job-topics.ts`).
 *
 * `ensure: true` provisions a missing project/group store and its
 * `Inventory/` folder, for callers about to write; a read probe passes
 * `false` and gets null for a store that does not exist yet. An archived
 * character's location still reads, but every write through it throws
 * `CharacterArchivedError`.
 *
 * Server-only.
 *
 * @module lib/inventory/location
 */

import { logger } from '@/lib/logger';
import { publishRealtime } from '@/lib/realtime/bus';
import {
  createInventoryFolderInMount,
  createInventoryInMount,
  deleteInventoryFolderInMount,
  deleteInventoryInMount,
  listInventoryFolderPathsInMount,
  listInventoryFoldersInMount,
  readMountInventory,
  renameInventoryFolderInMount,
  resolveInventoryMount,
  updateInventoryManyInMount,
  type InventoryMount,
  type InventoryRecordPatch,
} from '@/lib/inventory/vault-writes';
import { groupMountsFor, groupOriginMap, resolveOwnerStore } from '@/lib/mount-index/reach';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import {
  INVENTORY_FOLDER,
  type InventoryOrigin,
  type InventoryRecord,
  type InventoryScope,
} from '@/lib/schemas/inventory.types';
import { resolveInventoryFolder, type InventoryFolder } from '@/lib/inventory/folders';
import type { ItemFolderLocation } from '@/lib/mount-index/item-folder-location';

export { InventoryScopeSchema, type InventoryScope } from '@/lib/schemas/inventory.types';

/** What Quilltap General's objects are tagged with. */
export const GENERAL_INVENTORY_ORIGIN: InventoryOrigin = { scope: 'general', id: null, name: 'Quilltap General' };

/**
 * One Inventory tier's `Inventory/` folder: the shared folder half
 * (`ItemFolderLocation`) plus the Inventory's record reads and writes.
 */
export interface InventoryLocation extends ItemFolderLocation {
  scope: InventoryScope;
  /** What a collection read tags this tier's objects with. */
  origin: InventoryOrigin;
  /** Every record in the folder; archived ones only when asked. Unresolved. */
  readItems(includeArchived?: boolean): Promise<InventoryRecord[]>;
  /** One record from the folder (archived included), or null. */
  findItem(id: string): Promise<InventoryRecord | null>;
  create(record: InventoryRecord): Promise<InventoryRecord>;
  update(id: string, patch: Partial<InventoryRecord>, remove?: readonly string[]): Promise<InventoryRecord | null>;
  /** Patch several records with one read and one projection. */
  updateMany(patches: InventoryRecordPatch[], opts?: { requireAll?: boolean }): Promise<InventoryRecord[]>;
  /**
   * Delete records; `followOn` patches the survivors in the same projection
   * (a deleted kit member dropped from the kits that named it).
   */
  delete(ids: readonly string[], followOn?: (remaining: InventoryRecord[]) => InventoryRecordPatch[]): Promise<string[]>;
  listFolders(): Promise<InventoryFolder[]>;
}

export { locationKey } from '@/lib/mount-index/item-folder-location';

/** Identity and timestamps are the writer's, never a patch's. */
function cleanPatch(patch: Partial<InventoryRecord>): Partial<InventoryRecord> {
  const rest = { ...patch };
  delete rest.id;
  delete rest.createdAt;
  delete rest.updatedAt;
  return rest;
}

/**
 * Build a location over a folder. Writes re-resolve a character's mount at
 * write time so the tombstone check sees the character as it is now.
 */
export function inventoryLocationForMount(
  mount: InventoryMount,
  id: string | null,
  origin: InventoryOrigin,
): InventoryLocation {
  const writableMount = async (): Promise<InventoryMount> => {
    if (mount.scope !== 'character') return mount;
    const current = await resolveInventoryMount(mount.characterId);
    if (!current) throw new Error(`Character ${mount.characterId} has no linked vault`);
    return current;
  };

  /**
   * Run a write against the current writable mount, then tell the open
   * dialogs — only when something landed (`landed`, default always; a batch
   * that matched nothing changed nothing).
   */
  const write = async <T>(
    fn: (target: InventoryMount) => Promise<T>,
    landed: (result: T) => boolean = () => true,
  ): Promise<T> => {
    const result = await fn(await writableMount());
    if (landed(result)) publishRealtime('inventory');
    return result;
  };
  const nonEmpty = (result: readonly unknown[]) => result.length > 0;

  const updateMany: InventoryLocation['updateMany'] = (patches, opts) =>
    write(
      (target) => updateInventoryManyInMount(target, patches.map((p) => ({ ...p, patch: cleanPatch(p.patch) })), opts),
      nonEmpty,
    );

  return {
    scope: mount.scope,
    id,
    mountPointId: mount.mountPointId,
    characterId: mount.characterId,
    origin,
    async readItems(includeArchived = false) {
      const records = await readMountInventory(mount);
      return includeArchived ? records : records.filter((record) => !record.archivedAt);
    },
    async findItem(itemId) {
      return (await readMountInventory(mount)).find((record) => record.id === itemId) ?? null;
    },
    create: (record) => write((target) => createInventoryInMount(target, record)),
    async update(itemId, patch, remove) {
      const [updated] = await updateMany([{ id: itemId, patch, remove }]);
      return updated ?? null;
    },
    updateMany,
    delete: (ids, followOn) => write((target) => deleteInventoryInMount(target, ids, followOn), nonEmpty),
    async listFolders() {
      return listInventoryFoldersInMount(mount);
    },
    async resolveFolder(requested) {
      if (!requested || !requested.trim()) return '';
      return resolveInventoryFolder(await listInventoryFolderPathsInMount(mount), requested);
    },
    createFolder: (path) => write((target) => createInventoryFolderInMount(target, path)),
    renameFolder: (path, newName) => write((target) => renameInventoryFolderInMount(target, path, newName)),
    deleteFolder: (path) => write((target) => deleteInventoryFolderInMount(target, path)),
    async writableMountPointId() {
      return (await writableMount()).mountPointId;
    },
  };
}

export interface ResolveInventoryLocationOptions {
  /** Provision a missing project/group store and its folder. For writers. */
  ensure?: boolean;
}

/**
 * Resolve `{ scope, id }` to a location, or null when the owner is missing
 * (or, for a character, not `userId`'s), when a non-General scope arrives
 * without an id, or when the store does not exist and `ensure` is off.
 */
export async function resolveInventoryLocation(
  scope: InventoryScope,
  id: string | null | undefined,
  repos: RepositoryContainer,
  userId: string,
  opts: ResolveInventoryLocationOptions = {},
): Promise<InventoryLocation | null> {
  const location = await resolve(scope, id ?? null, repos, userId, opts.ensure === true);
  logger.debug('[InventoryLocation] Resolved inventory location', {
    scope,
    id: id ?? null,
    ensure: opts.ensure === true,
    found: location !== null,
    mountPointId: location?.mountPointId ?? null,
    op: 'resolve',
    context: 'inventory',
  });
  return location;
}

async function resolve(
  scope: InventoryScope,
  id: string | null,
  repos: RepositoryContainer,
  userId: string,
  ensure: boolean,
): Promise<InventoryLocation | null> {
  const store = await resolveOwnerStore(scope, id, repos, userId, {
    ensure: ensure ? { folder: INVENTORY_FOLDER, onFolderFailure: 'swallow' } : undefined,
    archived: 'allow',
    context: 'inventory',
  });
  if (!store) return null;
  if (store.scope === 'general') {
    return inventoryLocationForMount(
      { mountPointId: store.mountPointId, scope: 'general', characterId: null },
      null,
      GENERAL_INVENTORY_ORIGIN,
    );
  }
  const ownerId = store.owner.id as string;
  return inventoryLocationForMount(
    { mountPointId: store.mountPointId, scope: store.scope, characterId: store.scope === 'character' ? ownerId : null },
    ownerId,
    { scope: store.scope, id: ownerId, name: store.owner.name },
  );
}

/**
 * Every group store a character can reach, as locations — one per mount,
 * tagged with its group, strongest first (membership order; the first group
 * to claim a shared store keeps it).
 */
export async function groupLocationsForCharacter(characterId: string): Promise<InventoryLocation[]> {
  const origins = groupOriginMap(await groupMountsFor(characterId));
  return Array.from(origins, ([mountPointId, origin]) =>
    inventoryLocationForMount({ mountPointId, scope: 'group', characterId: null }, origin.id, origin),
  );
}
