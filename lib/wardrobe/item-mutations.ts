/**
 * Item mutations — the one way a wardrobe item is created or edited.
 *
 * The item routes (all four tiers), the `wardrobe_create` / `wardrobe_update`
 * tools and the transfer route build and patch items through here, so the
 * defaults, the composite `types` rule and the archive flag can't drift
 * between them:
 *
 *   - a fresh item's fields come from `wardrobeItemFromCreateBody`;
 *   - a composite's `types` are `buildCompositeTypes(components, designated)`
 *     — the components' slots plus any designated extras. Widen, never narrow
 *     (bug 195): an edit that doesn't restate `types` keeps every slot the
 *     composite already claimed;
 *   - `archived: boolean` becomes `archivedAt` through `archivedPatch`, which
 *     is idempotent (re-archiving keeps the original date, bug 188).
 *
 * Cycles are refused by the folder writer (`WardrobeComponentCycleError`).
 *
 * Server-only.
 *
 * @module lib/wardrobe/item-mutations
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { isComposite } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { archivedPatch } from '@/lib/wardrobe/archived-patch';
import { buildCompositeTypes } from '@/lib/wardrobe/composite-types';
import { wardrobeItemFromCreateBody, type WardrobeCreateBody } from '@/lib/wardrobe/create-body';
import type { WardrobeLocation } from '@/lib/wardrobe/location';
import { loadWearablePool } from '@/lib/wardrobe/pool';

/** Every item a composite in this location could name as a component. */
export type ComponentLookup = ReadonlyMap<string, WardrobeItem>;

/**
 * The components a composite at `location` may gather: a character's whole
 * wearable pool (project tier included when the caller knows it), or for a
 * shared tier its own folder plus Quilltap General.
 */
export async function componentLookupFor(
  repos: RepositoryContainer,
  location: WardrobeLocation,
  projectMountPointIds: readonly string[] = [],
): Promise<ComponentLookup> {
  if (location.characterId) {
    const pool = await loadWearablePool(repos, location.characterId, projectMountPointIds);
    return pool.byId;
  }
  const map = new Map<string, WardrobeItem>();
  if (location.scope !== 'general') {
    const { readGeneralWardrobe } = await import('@/lib/mount-index/general-wardrobe');
    for (const item of await readGeneralWardrobe(true)) map.set(item.id, item);
  }
  for (const item of await location.readItems(true)) map.set(item.id, item);
  return map;
}

/** Split component ids into the items found and the ids that weren't. */
export function validateComponentRefs(
  lookup: ComponentLookup,
  ids: readonly string[],
): { components: WardrobeItem[]; missing: string[] } {
  const components: WardrobeItem[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = lookup.get(id);
    if (item) components.push(item);
    else missing.push(id);
  }
  return { components, missing };
}

/** The `types` a composite stores, given its components and what it designates. */
function compositeTypes(
  lookup: ComponentLookup | undefined,
  componentItemIds: readonly string[],
  designated: readonly WardrobeItemType[],
): WardrobeItemType[] {
  if (!lookup) return [...designated];
  const { components } = validateComponentRefs(lookup, componentItemIds);
  const types = buildCompositeTypes(components, designated);
  return types.length > 0 ? types : [...designated];
}

export interface CreateItemOptions {
  /** Component lookup; without it a composite keeps the body's `types` as given. */
  lookup?: ComponentLookup;
  /** Keep an existing item's identity and history (transfers). */
  preserve?: Pick<WardrobeItem, 'id' | 'createdAt' | 'updatedAt'> &
    Partial<Pick<WardrobeItem, 'archivedAt' | 'imageFileId' | 'migratedFromClothingRecordId'>>;
}

/** Create an item at a location from a create body. */
export async function createItem(
  location: WardrobeLocation,
  body: WardrobeCreateBody,
  opts: CreateItemOptions = {},
): Promise<WardrobeItem> {
  const fields = wardrobeItemFromCreateBody(body, location.characterId);
  if (isComposite(fields)) {
    fields.types = compositeTypes(opts.lookup, fields.componentItemIds, fields.types);
  }
  const now = new Date().toISOString();
  const item: WardrobeItem = {
    ...fields,
    id: opts.preserve?.id ?? randomUUID(),
    archivedAt: opts.preserve?.archivedAt ?? null,
    imageFileId: opts.preserve?.imageFileId ?? null,
    migratedFromClothingRecordId: opts.preserve?.migratedFromClothingRecordId ?? null,
    createdAt: opts.preserve?.createdAt ?? now,
    updatedAt: opts.preserve?.updatedAt ?? now,
  };
  const stored = await location.create(item);
  logger.debug('[ItemMutations] Created wardrobe item', {
    scope: location.scope,
    mountPointId: location.mountPointId,
    itemId: stored.id,
    composite: isComposite(stored),
    types: stored.types,
    context: 'wardrobe',
  });
  return stored;
}

/** An edit: any item field, plus the request-shaped archive flag. */
export type ItemPatch = Partial<Omit<WardrobeItem, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt'>> & {
  archived?: boolean;
};

/**
 * Patch `current` at its location. A composite's `types` are recomputed
 * whenever its components or designated slots change, widening over the
 * slots it already claimed unless the patch restates them.
 */
export async function updateItem(
  location: WardrobeLocation,
  current: WardrobeItem,
  patch: ItemPatch,
  opts: { lookup?: ComponentLookup } = {},
): Promise<WardrobeItem | null> {
  const { archived, ...fields } = patch;
  const next: Partial<WardrobeItem> = { ...fields };

  if (archived !== undefined) {
    const stamp = archivedPatch(current.archivedAt, archived, new Date().toISOString());
    if (stamp) next.archivedAt = stamp.archivedAt;
  }

  const componentItemIds = fields.componentItemIds ?? current.componentItemIds;
  if (componentItemIds.length > 0 && (fields.componentItemIds !== undefined || fields.types !== undefined)) {
    next.types = compositeTypes(opts.lookup, componentItemIds, fields.types ?? current.types);
  }

  const updated = await location.update(current.id, next);
  logger.debug('[ItemMutations] Updated wardrobe item', {
    scope: location.scope,
    mountPointId: location.mountPointId,
    itemId: current.id,
    fields: Object.keys(next),
    found: updated !== null,
    context: 'wardrobe',
  });
  return updated;
}

/**
 * Archive (or restore) an item. Idempotent: an item already in the requested
 * state is returned untouched with `changed: false`.
 */
export async function setItemArchived(
  location: WardrobeLocation,
  current: WardrobeItem,
  archived: boolean,
): Promise<{ item: WardrobeItem | null; changed: boolean }> {
  const stamp = archivedPatch(current.archivedAt, archived, new Date().toISOString());
  if (!stamp) return { item: current, changed: false };
  const item = await location.update(current.id, stamp);
  logger.debug('[ItemMutations] Wardrobe item archive state changed', {
    scope: location.scope,
    itemId: current.id,
    archivedAt: stamp.archivedAt,
    context: 'wardrobe',
  });
  return { item, changed: item !== null };
}
