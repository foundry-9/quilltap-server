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
 * Every write through a location publishes the `inventory` realtime topic
 * once it lands, so an open Inventory dialog re-reads whoever made the change
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
import { getGeneralMountPointId } from '@/lib/instance-settings';
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
} from '@/lib/database/repositories/vault-overlay/inventory-writes';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { ensureOwnerOfficialStore } from '@/lib/mount-index/ensure-owner-store';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import {
  INVENTORY_FOLDER,
  type InventoryOrigin,
  type InventoryRecord,
  type InventoryScope,
} from '@/lib/schemas/inventory.types';
import { resolveInventoryFolder, type InventoryFolder } from '@/lib/inventory/folders';

export { InventoryScopeSchema, type InventoryScope } from '@/lib/schemas/inventory.types';

/** What Quilltap General's objects are tagged with. */
export const GENERAL_INVENTORY_ORIGIN: InventoryOrigin = { scope: 'general', id: null, name: 'Quilltap General' };

export interface InventoryLocation {
  scope: InventoryScope;
  /** Owner id; null for General. */
  id: string | null;
  /** The mount holding the `Inventory/` folder. */
  mountPointId: string;
  /** The owning character — `character` scope only. */
  characterId: string | null;
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
  /** Resolve an operator's requested folder against this tier's folders. */
  resolveFolder(requested: string): Promise<string>;
  createFolder(path: string): Promise<InventoryFolder>;
  renameFolder(path: string, newName: string): Promise<InventoryFolder>;
  deleteFolder(path: string): Promise<{ movedItems: number; movedFolders: number; parent: string }>;
  /** The mount, checked for writing (throws `CharacterArchivedError`). */
  writableMountPointId(): Promise<string>;
}

/** A key naming one folder, for "same source and destination?" checks. */
export function locationKey(loc: Pick<InventoryLocation, 'scope' | 'mountPointId'>): string {
  return `${loc.scope}:${loc.mountPointId}`;
}

/** Idempotent: ensure a mount's `Inventory/` folder exists; failure is logged, not thrown. */
async function ensureInventoryFolder(mountPointId: string): Promise<void> {
  try {
    await ensureFolderPath(mountPointId, INVENTORY_FOLDER);
  } catch (error) {
    logger.warn('[InventoryLocation] Failed to ensure Inventory folder', {
      mountPointId,
      context: 'inventory',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

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

  /** Run a write against the current writable mount, then tell the open dialogs. */
  const write = async <T>(fn: (target: InventoryMount) => Promise<T>): Promise<T> => {
    const result = await fn(await writableMount());
    publishRealtime('inventory');
    return result;
  };

  const updateMany: InventoryLocation['updateMany'] = (patches, opts) =>
    write((target) =>
      updateInventoryManyInMount(target, patches.map((p) => ({ ...p, patch: cleanPatch(p.patch) })), opts),
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
    delete: (ids, followOn) => write((target) => deleteInventoryInMount(target, ids, followOn)),
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
  if (scope === 'general') {
    const mountPointId = await getGeneralMountPointId();
    if (!mountPointId) return null;
    if (ensure) await ensureInventoryFolder(mountPointId);
    return inventoryLocationForMount({ mountPointId, scope: 'general', characterId: null }, null, GENERAL_INVENTORY_ORIGIN);
  }

  if (!id) return null;

  if (scope === 'character') {
    const character = await repos.characters.findByIdRaw(id);
    if (!character || character.userId !== userId) return null;
    const mountPointId = character.characterDocumentMountPointId;
    if (!mountPointId) return null;
    return inventoryLocationForMount(
      { mountPointId, scope: 'character', characterId: character.id },
      character.id,
      { scope: 'character', id: character.id, name: character.name },
    );
  }

  const owner = scope === 'project' ? await repos.projects.findById(id) : await repos.groups.findById(id);
  if (!owner) return null;
  const name = owner.name || (scope === 'project' ? 'Project' : 'Group');

  let mountPointId: string | null = null;
  if (ensure) {
    const ensured = await ensureOwnerOfficialStore(scope, owner.id, name);
    if (!ensured) return null;
    mountPointId = ensured.mountPointId;
    await ensureInventoryFolder(mountPointId);
  } else {
    mountPointId = owner.officialMountPointId ?? null;
  }
  if (!mountPointId) return null;

  return inventoryLocationForMount({ mountPointId, scope, characterId: null }, owner.id, {
    scope,
    id: owner.id,
    name: owner.name,
  });
}

/**
 * Every group store a character can reach, as locations — one per mount,
 * tagged with its group, in the order the group tier shadows (later wins).
 */
export async function groupLocationsForCharacter(characterId: string): Promise<InventoryLocation[]> {
  const { resolveGroupMountsForCharacter } = await import('@/lib/mount-index/tiered-mount-pool');
  const groups = await resolveGroupMountsForCharacter(characterId);
  return groups.flatMap(({ group, mountPointIds }) =>
    mountPointIds.map((mountPointId) =>
      inventoryLocationForMount({ mountPointId, scope: 'group', characterId: null }, group.id, {
        scope: 'group',
        id: group.id,
        name: group.name,
      }),
    ),
  );
}
