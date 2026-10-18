/**
 * Inventory mutations — the one way an Inventory object is created, edited,
 * instantiated, detached, copied, filed, archived or deleted. The routes call
 * these (and the tools spec will), so the shape rules, the `canCopy` and
 * archetype guards and the SVG sanitiser live once:
 *
 *   - a kit's members must resolve in the writer's pool to an item or an
 *     archetype, never a kit (`KIT_NESTING`);
 *   - `instantiate` writes `{ id, parentId, ...overrides }` and nothing else,
 *     so the instance inherits every field it does not override;
 *   - an instance's edit stores only the keys patched; `clearOverrides`
 *     removes keys (a JSON PUT cannot say "remove");
 *   - `detach` bakes the resolved values in and nulls `parentId`;
 *     `detachAll` does it everywhere, refusing when an archived character
 *     holds an instance (`ARCHIVED_DEPENDENTS`);
 *   - an archetype with dependents is deleted only with `force` (bake first),
 *     and a deleted kit member is dropped from the kits of its tier;
 *   - `canCopy: false` refuses every copy (`NOT_COPYABLE`); move and
 *     instantiate stay allowed.
 *
 * Every mutation logs at `debug`; refusals at `info` with the code.
 *
 * Server-only.
 *
 * @module lib/inventory/item-mutations
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import {
  INVENTORY_INHERITABLE_FIELDS,
  inventoryShapeIssues,
  type InventoryCreateBody,
  type InventoryInheritableField,
  type InventoryRecord,
  type InventoryUpdateBody,
  type ResolvedInventoryItem,
} from '@/lib/schemas/inventory.types';
import { archivedPatch } from '@/lib/wardrobe/archived-patch';
import { nextCopyTitle } from '@/lib/wardrobe/next-copy-title';
import {
  readMountInventory,
  updateInventoryManyInMount,
  type InventoryMount,
} from '@/lib/database/repositories/vault-overlay/inventory-writes';
import { resolveVaultFolderMount } from '@/lib/database/repositories/vault-overlay/item-folder-ops';
import { InventoryItemNotInLocationError, isSameFolder } from '@/lib/inventory/folders';
import { findDependents, findRecordsAnywhere, type InventoryDependent } from '@/lib/inventory/dependents';
import {
  InventoryArchetypeInUseError,
  InventoryArchivedDependentsError,
  InventoryInvalidParentError,
  InventoryKitNestingError,
  InventoryNotCopyableError,
  InventoryRefusal,
  InventoryShapeError,
} from '@/lib/inventory/errors';
import type { InventoryLocation } from '@/lib/inventory/location';
import { loadPoolForLocation, type InventoryPool } from '@/lib/inventory/pool';
import { resolveItem, withInventoryDefaults } from '@/lib/inventory/resolve';
import { sanitizeInventorySvg } from '@/lib/inventory/svg';
import { cleanupInventoryItemImages } from '@/lib/inventory/item-images';

type Repos = Pick<RepositoryContainer, 'characters' | 'chats'>;

/** Log a refusal at `info` and throw it. */
function refuse(error: InventoryRefusal, meta: Record<string, unknown>): never {
  logger.info('[InventoryMutations] Refused', { code: error.code, message: error.message, ...meta, context: 'inventory' });
  throw error;
}

function logOp(op: string, location: InventoryLocation, meta: Record<string, unknown>): void {
  logger.debug(`[InventoryMutations] ${op}`, {
    op,
    scope: location.scope,
    mountPointId: location.mountPointId,
    ...meta,
    context: 'inventory',
  });
}

/**
 * Check a kit's members against the pool the kit is written in: each must
 * resolve to an item or an archetype. Missing ones are a 400, kits a 409.
 */
function assertKitMembers(pool: InventoryPool, itemIds: readonly string[], meta: Record<string, unknown>): void {
  const missing: string[] = [];
  const kits: string[] = [];
  for (const id of itemIds) {
    const member = pool.get(id);
    if (!member) missing.push(id);
    else if (member.kind === 'kit') kits.push(id);
  }
  if (kits.length > 0) refuse(new InventoryKitNestingError(kits), meta);
  if (missing.length > 0) {
    refuse(new InventoryShapeError(`Kit members not reachable from this tier: ${missing.join(', ')}`, { missing }), meta);
  }
}

function assertShape(record: Partial<InventoryRecord>, meta: Record<string, unknown>): void {
  const issues = inventoryShapeIssues(record);
  if (issues.length > 0) refuse(new InventoryShapeError(issues.join('; '), { issues }), meta);
}

// ============================================================================
// Create
// ============================================================================

export interface CreateInventoryItemOptions {
  /** Keep an existing object's identity and history (transfers). */
  preserve?: Pick<InventoryRecord, 'id' | 'createdAt' | 'updatedAt'> &
    Partial<Pick<InventoryRecord, 'archivedAt' | 'imageFileId'>>;
  /** A pool already loaded for the location (a kit's member check). */
  pool?: InventoryPool;
}

/** Create a standalone object, archetype or kit at a location. */
export async function createInventoryItem(
  repos: Repos,
  location: InventoryLocation,
  body: InventoryCreateBody,
  opts: CreateInventoryItemOptions = {},
): Promise<InventoryRecord> {
  const meta = { scope: location.scope, mountPointId: location.mountPointId, op: 'create' };
  const { folder, ...fields } = body;
  assertShape(fields, meta);
  if (fields.parentId) refuse(new InventoryInvalidParentError('Create an instance with instantiate'), meta);
  const itemIds = Array.from(new Set(fields.itemIds ?? []));
  if (fields.kind === 'kit') {
    assertKitMembers(opts.pool ?? (await loadPoolForLocation(repos, location)), itemIds, meta);
  }
  const now = new Date().toISOString();
  const record: InventoryRecord = {
    ...withInventoryDefaults({
      ...fields,
      id: opts.preserve?.id ?? randomUUID(),
      createdAt: opts.preserve?.createdAt ?? now,
      updatedAt: opts.preserve?.updatedAt ?? now,
      folder: '',
    }),
    itemIds,
    svg: sanitizeInventorySvg(fields.svg),
    archivedAt: opts.preserve?.archivedAt ?? null,
    imageFileId: opts.preserve?.imageFileId ?? null,
    folder: folder ? await location.resolveFolder(folder) : '',
  };
  const stored = await location.create(record);
  logOp('Created object', location, { itemId: stored.id, kind: stored.kind, isArchetype: stored.isArchetype, folder: stored.folder });
  return stored;
}

// ============================================================================
// Instantiate
// ============================================================================

export interface InstantiateOptions {
  folder?: string;
  overrides?: Partial<Pick<InventoryRecord, InventoryInheritableField>>;
  /** The destination's pool, when the caller already has it. */
  pool?: InventoryPool;
}

/**
 * Make an instance of an archetype at a location. The archetype must be an
 * archetype and reachable from the destination. Instantiating is not
 * copying: `canCopy` does not apply. Returns the record and its resolution.
 */
export async function instantiate(
  repos: Repos,
  location: InventoryLocation,
  archetypeId: string,
  opts: InstantiateOptions = {},
): Promise<{ record: InventoryRecord; item: ResolvedInventoryItem }> {
  const meta = { scope: location.scope, mountPointId: location.mountPointId, archetypeId, op: 'instantiate' };
  const pool = opts.pool ?? (await loadPoolForLocation(repos, location));
  const archetype = pool.get(archetypeId);
  if (!archetype || !archetype.isArchetype) {
    refuse(new InventoryInvalidParentError('The parent must be an archetype this tier can reach', { archetypeId }), meta);
  }
  if (archetype.archivedAt) {
    refuse(new InventoryInvalidParentError('An archived archetype cannot be instantiated', { archetypeId }), meta);
  }
  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts.overrides ?? {})) {
    if ((INVENTORY_INHERITABLE_FIELDS as readonly string[]).includes(key) && value !== undefined) overrides[key] = value;
  }
  if ('svg' in overrides) overrides.svg = sanitizeInventorySvg(overrides.svg as string | null);
  const now = new Date().toISOString();
  const record: InventoryRecord = {
    id: randomUUID(),
    parentId: archetypeId,
    ...overrides,
    createdAt: now,
    updatedAt: now,
    folder: opts.folder ? await location.resolveFolder(opts.folder) : '',
    // The file is named after the archetype until the instance has a title of its own.
    fileStem: archetype.title || archetype.name || undefined,
  };
  const stored = await location.create(record);
  const item = resolveItem(stored, (id) => (id === archetypeId ? archetype : pool.get(id)));
  logOp('Instantiated archetype', location, { itemId: stored.id, archetypeId, overrides: Object.keys(overrides) });
  return { record: stored, item };
}

// ============================================================================
// Update / clear overrides / archive
// ============================================================================

/**
 * Patch a record at its location. An instance stores only the keys patched.
 * Turning an archetype with dependents into an item is `ARCHETYPE_IN_USE`;
 * making an instance or a kit an archetype is `INVALID_PARENT`.
 */
export async function updateInventoryItem(
  repos: Repos,
  location: InventoryLocation,
  current: InventoryRecord,
  body: InventoryUpdateBody,
): Promise<InventoryRecord | null> {
  const meta = { scope: location.scope, mountPointId: location.mountPointId, itemId: current.id, op: 'update' };
  const { archived, folder, ...fields } = body;
  const patch: Partial<InventoryRecord> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
  }

  if (current.parentId) {
    if (patch.isArchetype) refuse(new InventoryInvalidParentError('An instance cannot be an archetype'), meta);
    if (patch.kind === 'kit' || (patch.itemIds && patch.itemIds.length > 0)) {
      refuse(new InventoryShapeError('An instance is an item, never a kit'), meta);
    }
    delete patch.kind;
    delete patch.isArchetype;
    delete patch.itemIds;
  } else {
    const nextKind = patch.kind ?? current.kind ?? 'item';
    if (patch.isArchetype === true && !current.isArchetype && nextKind === 'kit') {
      refuse(new InventoryInvalidParentError('A kit cannot be an archetype'), meta);
    }
    if (patch.isArchetype === false && current.isArchetype) {
      const dependents = await findDependents(current.id);
      if (dependents.length > 0) refuse(new InventoryArchetypeInUseError(dependents.length, holdersOf(dependents)), meta);
    }
    if (patch.kind === 'kit' && current.isArchetype && patch.isArchetype !== false) {
      refuse(new InventoryInvalidParentError('An archetype cannot be a kit'), meta);
    }
    assertShape({ ...current, ...patch }, meta);
    if (nextKind === 'kit' && patch.itemIds !== undefined) {
      patch.itemIds = Array.from(new Set(patch.itemIds));
      assertKitMembers(await loadPoolForLocation(repos, location), patch.itemIds, meta);
    }
  }

  if (patch.svg !== undefined) patch.svg = sanitizeInventorySvg(patch.svg);
  if (folder !== undefined && !isSameFolder(folder, current.folder)) patch.folder = await location.resolveFolder(folder);
  if (archived !== undefined) {
    const stamp = archivedPatch(current.archivedAt, archived, new Date().toISOString());
    if (stamp) patch.archivedAt = stamp.archivedAt;
  }

  const updated = await location.update(current.id, patch);
  logOp('Updated object', location, { itemId: current.id, fields: Object.keys(patch), found: updated !== null });
  return updated;
}

/** Remove an instance's overrides so those fields inherit again. */
export async function clearOverrides(
  location: InventoryLocation,
  current: InventoryRecord,
  fields: readonly InventoryInheritableField[],
): Promise<InventoryRecord | null> {
  const meta = { scope: location.scope, mountPointId: location.mountPointId, itemId: current.id, op: 'clear-override' };
  if (!current.parentId) refuse(new InventoryInvalidParentError('Only an instance inherits; this object has no archetype'), meta);
  const updated = await location.update(current.id, {}, fields);
  logOp('Cleared overrides', location, { itemId: current.id, fields });
  return updated;
}

/** Archive (or restore) an object. Idempotent. */
export async function setInventoryItemArchived(
  location: InventoryLocation,
  current: InventoryRecord,
  archived: boolean,
): Promise<{ item: InventoryRecord | null; changed: boolean }> {
  const stamp = archivedPatch(current.archivedAt, archived, new Date().toISOString());
  if (!stamp) return { item: current, changed: false };
  const item = await location.update(current.id, stamp);
  logOp('Archive state changed', location, { itemId: current.id, archivedAt: stamp.archivedAt });
  return { item, changed: item !== null };
}

// ============================================================================
// Detach
// ============================================================================

/** The fields a bake writes: the resolved values, the parent's picture left behind. */
function bakedFields(record: InventoryRecord, resolved: ResolvedInventoryItem): Partial<InventoryRecord> {
  const baked: Record<string, unknown> = { parentId: null, kind: 'item', isArchetype: false, itemIds: [] };
  const source = resolved as unknown as Record<string, unknown>;
  for (const field of INVENTORY_INHERITABLE_FIELDS) {
    if (field === 'imageFileId') continue;
    baked[field] = source[field];
  }
  // A picture is kept only when it is the instance's own; the archetype's
  // pictures belong to the archetype (and go with it).
  baked.imageFileId = record.imageFileId ?? null;
  return baked as Partial<InventoryRecord>;
}

/** Break an instance's tie to its archetype, baking the resolved values in. */
export async function detach(
  repos: Repos,
  location: InventoryLocation,
  current: InventoryRecord,
  pool?: InventoryPool,
): Promise<InventoryRecord | null> {
  const meta = { scope: location.scope, mountPointId: location.mountPointId, itemId: current.id, op: 'detach' };
  if (!current.parentId) refuse(new InventoryInvalidParentError('This object has no archetype to detach from'), meta);
  const lookupPool = pool ?? (await loadPoolForLocation(repos, location));
  const resolved = lookupPool.resolve(current);
  const updated = await location.update(current.id, bakedFields(current, resolved));
  logOp('Detached instance', location, { itemId: current.id, parentId: current.parentId, parentMissing: resolved.parentMissing });
  return updated;
}

function holdersOf(dependents: readonly InventoryDependent[]) {
  const seen = new Map<string, { scope: string; ownerId: string | null; ownerName: string | null }>();
  for (const d of dependents) {
    const key = `${d.scope}:${d.ownerId ?? d.mountPointId}`;
    if (!seen.has(key)) seen.set(key, { scope: d.scope, ownerId: d.ownerId, ownerName: d.ownerName });
  }
  return Array.from(seen.values());
}

/**
 * Detach every instance of an archetype, wherever it lives — one write per
 * mount. Refused (`ARCHIVED_DEPENDENTS`) when any instance lives in an
 * archived character's vault. Returns how many were baked.
 */
export async function detachAll(archetypeId: string): Promise<number> {
  const meta = { itemId: archetypeId, op: 'detach-all' };
  const dependents = await findDependents(archetypeId);
  const archived = dependents.filter((d) => d.ownerArchived);
  if (archived.length > 0) {
    const characters = Array.from(new Map(archived.map((d) => [d.ownerId, { id: d.ownerId, name: d.ownerName }])).values());
    refuse(new InventoryArchivedDependentsError(characters), meta);
  }
  if (dependents.length === 0) return 0;

  const archetype = (await findRecordsAnywhere([archetypeId])).get(archetypeId)?.record;
  const byMount = new Map<string, InventoryDependent[]>();
  for (const d of dependents) byMount.set(d.mountPointId, [...(byMount.get(d.mountPointId) ?? []), d]);

  let baked = 0;
  for (const [mountPointId, group] of byMount) {
    const first = group[0];
    // A character's vault is re-resolved so the tombstone check sees it now.
    const mount: InventoryMount | null =
      first.scope === 'character'
        ? await resolveVaultFolderMount(first.ownerId)
        : { mountPointId, scope: first.scope === 'unknown' ? 'project' : first.scope, characterId: null };
    if (!mount) continue;
    const records = new Map((await readMountInventory(mount)).map((r) => [r.id, r]));
    const patches = group
      .map((d) => records.get(d.id))
      .filter((r): r is InventoryRecord => !!r)
      .map((record) => ({
        id: record.id,
        patch: bakedFields(record, resolveItem(record, (id) => (id === archetypeId ? archetype : undefined))),
      }));
    const written = await updateInventoryManyInMount(mount, patches);
    baked += written.length;
    logger.debug('[InventoryMutations] Baked instances in one mount', {
      op: 'detach-all',
      mountPointId,
      scope: mount.scope,
      itemId: archetypeId,
      count: written.length,
      context: 'inventory',
    });
  }
  return baked;
}

// ============================================================================
// Delete
// ============================================================================

/**
 * Delete an object. An archetype with dependents needs `force` (every
 * instance is baked first); without it, `ARCHETYPE_IN_USE`. A deleted object
 * is dropped from every kit in the same tier that named it (a kit never
 * empties: its last member stays named and is skipped at equip time). Its
 * pictures go with it. Chats' equipped sets are not scrubbed — the reader
 * drops the id and the next equip write prunes it.
 */
export async function deleteInventoryItem(
  repos: RepositoryContainer,
  location: InventoryLocation,
  current: InventoryRecord,
  opts: { force?: boolean } = {},
): Promise<{ deleted: boolean; detached: number }> {
  const meta = { scope: location.scope, mountPointId: location.mountPointId, itemId: current.id, op: 'delete' };
  // Refuse a tombstone before anything else is touched.
  await location.writableMountPointId();

  let detached = 0;
  if (current.isArchetype) {
    const dependents = await findDependents(current.id);
    if (dependents.length > 0) {
      if (!opts.force) refuse(new InventoryArchetypeInUseError(dependents.length, holdersOf(dependents)), meta);
      detached = await detachAll(current.id);
    }
  }

  const deleted = await location.delete([current.id], (remaining) =>
    remaining
      .filter((record) => record.kind === 'kit' && (record.itemIds ?? []).includes(current.id) && (record.itemIds ?? []).length > 1)
      .map((kit) => ({ id: kit.id, patch: { itemIds: (kit.itemIds ?? []).filter((id) => id !== current.id) } })),
  );
  if (deleted.length > 0) {
    await cleanupInventoryItemImages(repos, current.id, '[InventoryMutations]', meta);
  }
  logOp('Deleted object', location, { itemId: current.id, deleted: deleted.length > 0, forced: !!opts.force, detached });
  return { deleted: deleted.length > 0, detached };
}

// ============================================================================
// Copies and filing
// ============================================================================

/** Refuse a copy of any object whose resolved `canCopy` is false. */
export function assertCopyable(items: readonly Pick<ResolvedInventoryItem, 'id' | 'canCopy'>[], meta: Record<string, unknown> = {}): void {
  const blocked = items.filter((item) => !item.canCopy).map((item) => item.id);
  if (blocked.length > 0) refuse(new InventoryNotCopyableError(blocked), meta);
}

/** The record a copy writes: a new id and timestamps, nothing archived, no picture. */
function copyRecord(source: InventoryRecord, folder: string, title?: string | null): InventoryRecord {
  const now = new Date().toISOString();
  return {
    ...source,
    id: randomUUID(),
    folder,
    ...(title !== undefined && { title }),
    archivedAt: null,
    imageFileId: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Duplicate one object beside itself, titled `(copy)`; refused when not copyable. */
export async function duplicateInventoryItem(
  repos: Repos,
  location: InventoryLocation,
  current: InventoryRecord,
): Promise<InventoryRecord> {
  const pool = await loadPoolForLocation(repos, location);
  const resolved = pool.resolve(current);
  assertCopyable([resolved], { itemId: current.id, op: 'duplicate' });
  const titles = (await location.readItems(true)).map((r) => r.title || r.name || '').filter(Boolean);
  const copy = copyRecord(current, current.folder ?? '', nextCopyTitle(resolved.title || resolved.name, titles));
  const stored = await location.create(copy);
  logOp('Duplicated object', location, { itemId: current.id, copyId: stored.id });
  return stored;
}

/** File several objects of this location into one folder (one projection). */
export async function moveInventoryItemsToFolder(
  location: InventoryLocation,
  itemIds: readonly string[],
  folder: string,
): Promise<InventoryRecord[]> {
  const target = await location.resolveFolder(folder);
  const uniqueIds = Array.from(new Set(itemIds));
  const moved = await location.updateMany(uniqueIds.map((id) => ({ id, patch: { folder: target } })), { requireAll: true });
  logOp('Moved objects to folder', location, { folder: target, requested: uniqueIds.length, moved: moved.length });
  return moved;
}

/** Copy several objects of this location into one folder; any not copyable refuses the batch. */
export async function copyInventoryItemsToFolder(
  repos: Repos,
  location: InventoryLocation,
  itemIds: readonly string[],
  folder: string,
): Promise<InventoryRecord[]> {
  const target = await location.resolveFolder(folder);
  const records = new Map((await location.readItems(true)).map((r) => [r.id, r]));
  const uniqueIds = Array.from(new Set(itemIds));
  const missing = uniqueIds.filter((id) => !records.has(id));
  if (missing.length > 0) throw new InventoryItemNotInLocationError(missing);
  const pool = await loadPoolForLocation(repos, location);
  const sources = uniqueIds.map((id) => records.get(id) as InventoryRecord);
  assertCopyable(sources.map((r) => pool.resolve(r)), { op: 'copy-items', folder: target });
  const copies: InventoryRecord[] = [];
  for (const source of sources) copies.push(await location.create(copyRecord(source, target)));
  logOp('Copied objects to folder', location, { folder: target, count: copies.length });
  return copies;
}
