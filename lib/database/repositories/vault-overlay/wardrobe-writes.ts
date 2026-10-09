/**
 * Wardrobe writes — the one place a wardrobe item reaches disk.
 *
 * Every wardrobe tier is a `Wardrobe/` folder in some mount: a character's
 * vault, Quilltap General, a project store or a group store. Each mutation
 * reads the folder's current items, applies the change in memory, and
 * re-projects the whole folder via `projectVaultWardrobe` (which dedupes
 * filenames, renames on title change, and sweeps removed files). The
 * `wardrobe_items` DB table is gone; nothing here writes a row.
 *
 * Writes to a given mount are serialized through a per-mount promise chain so
 * two concurrent mutations can't each read a stale snapshot and clobber one
 * another.
 *
 * Callers address a folder through a {@link WardrobeMount}. New code gets one
 * from `resolveWardrobeLocation` (`lib/wardrobe/location.ts`), which also owns
 * the archived-character tombstone; {@link resolveWardrobeMount} is the
 * character-id-or-General resolver the repository's legacy adapters and the
 * location module share.
 *
 * @module database/repositories/vault-overlay/wardrobe-writes
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { CharacterArchivedError } from '../characters.repository';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { isComposite } from '@/lib/schemas/wardrobe.types';
import { detectComponentCycles } from '@/lib/wardrobe/expand-composites';
import { readCharacterVaultWardrobe } from './vault-readers';
import { projectVaultWardrobe } from './wardrobe-sync';

/** The four wardrobe tiers. */
export type WardrobeMountScope = 'character' | 'group' | 'project' | 'general';

/** A wardrobe tier's folder on disk. */
export interface WardrobeMount {
  mountPointId: string;
  scope: WardrobeMountScope;
  /** Owning character for the `character` scope; null for every shared tier. */
  characterId: string | null;
}

// Per-mount serialization so concurrent writes don't read a stale folder.
const writeChains = new Map<string, Promise<unknown>>();

function runSerialized<T>(mountPointId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(mountPointId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  writeChains.set(mountPointId, next);
  void next
    .catch(() => {})
    .finally(() => {
      if (writeChains.get(mountPointId) === next) writeChains.delete(mountPointId);
    });
  return next;
}

/**
 * Resolve the folder for a character id, or Quilltap General for `null`.
 * Returns null when no mount is available (no linked vault, General not yet
 * provisioned). Throws `CharacterArchivedError` for an archived character: a
 * pruned vault is still live, so refusing here is what keeps the tombstone.
 */
export async function resolveWardrobeMount(
  characterId: string | null | undefined,
): Promise<WardrobeMount | null> {
  if (characterId == null) {
    const mountPointId = await getGeneralMountPointId();
    if (!mountPointId) return null;
    return { mountPointId, scope: 'general', characterId: null };
  }
  const character = await getRepositories().characters.findByIdRaw(characterId);
  if (character?.archivedAt) {
    throw new CharacterArchivedError(characterId);
  }
  const mountPointId = character?.characterDocumentMountPointId;
  if (!mountPointId) return null;
  return { mountPointId, scope: 'character', characterId };
}

/** A shared-tier folder (project or group store) addressed by its mount. */
export function mountWardrobeLocation(
  mountPointId: string,
  scope: Exclude<WardrobeMountScope, 'character'> = 'project',
): WardrobeMount {
  return { mountPointId, scope, characterId: null };
}

/**
 * Every item (archived included) currently in the folder, `characterId`
 * coerced to the folder's owner. Component refs that live in another tier
 * stay as UUIDs (see `resolveAndCheckComponentItems`).
 */
export async function readMountItems(mount: WardrobeMount): Promise<WardrobeItem[]> {
  const vault = await readCharacterVaultWardrobe(
    mount.mountPointId,
    mount.characterId ?? undefined,
  );
  if (!vault) return [];
  return vault.items.map((item) => ({ ...item, characterId: mount.characterId }));
}

/**
 * The id→item map a save-time cycle check walks: the folder's own items, then
 * every other item the folder's composites could reach. A character's composite
 * can gather parts from any tier the character wears from, so its peers are the
 * character's whole wearable pool; a shared composite's are General's items.
 */
async function buildCyclePeers(
  mount: WardrobeMount,
  current: readonly WardrobeItem[],
): Promise<Map<string, WardrobeItem>> {
  const map = new Map<string, WardrobeItem>();
  for (const item of current) map.set(item.id, item);
  try {
    if (mount.characterId) {
      const { loadWearablePool } = await import('@/lib/wardrobe/pool');
      const pool = await loadWearablePool(getRepositories(), mount.characterId, undefined, {
        ownItems: current,
      });
      for (const item of pool.byId.values()) {
        if (!map.has(item.id)) map.set(item.id, item);
      }
    } else if (mount.scope !== 'general') {
      const { readGeneralWardrobe } = await import('@/lib/mount-index/general-wardrobe');
      for (const item of await readGeneralWardrobe(true)) {
        if (!map.has(item.id)) map.set(item.id, item);
      }
    }
  } catch (error) {
    logger.warn('Wardrobe cycle check could not load peer tiers; checking the folder alone', {
      mountPointId: mount.mountPointId,
      scope: mount.scope,
      context: 'wardrobe',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return map;
}

/** The message every cycle refusal carries; the routes map it to a 400. */
export const COMPONENT_CYCLE_MESSAGE = 'component cycle';

/** Thrown when a save would make a composite contain itself. */
export class WardrobeComponentCycleError extends Error {
  constructor(itemId: string, cycles: string[][]) {
    super(
      `Wardrobe item ${itemId} would create a ${COMPONENT_CYCLE_MESSAGE}: ${cycles
        .map((c) => c.join(' → '))
        .join('; ')}`,
    );
    this.name = 'WardrobeComponentCycleError';
  }
}

function assertNoCycles(item: WardrobeItem, peers: Map<string, WardrobeItem>): void {
  if (!isComposite(item)) return;
  peers.set(item.id, item);
  const cycles = detectComponentCycles(item.id, item.componentItemIds, peers);
  if (cycles.length > 0) {
    throw new WardrobeComponentCycleError(item.id, cycles);
  }
}

/** Create an item in the folder. */
export async function createInMount(mount: WardrobeMount, item: WardrobeItem): Promise<WardrobeItem> {
  return runSerialized(mount.mountPointId, async () => {
    const current = await readMountItems(mount);
    assertNoCycles(item, await buildCyclePeers(mount, current));
    const stored: WardrobeItem = { ...item, characterId: mount.characterId };
    await projectVaultWardrobe(mount.mountPointId, mount.characterId ?? mount.mountPointId, [
      ...current,
      stored,
    ]);
    logger.debug('Wardrobe item created in folder', {
      mountPointId: mount.mountPointId,
      scope: mount.scope,
      wardrobeItemId: stored.id,
      context: 'wardrobe',
    });
    return stored;
  });
}

/** Patch an item in the folder; null when the id isn't there. */
export async function updateInMount(
  mount: WardrobeMount,
  id: string,
  patch: Partial<WardrobeItem>,
): Promise<WardrobeItem | null> {
  return runSerialized(mount.mountPointId, async () => {
    const current = await readMountItems(mount);
    const idx = current.findIndex((i) => i.id === id);
    if (idx < 0) return null;

    const merged: WardrobeItem = {
      ...current[idx],
      ...patch,
      id: current[idx].id,
      characterId: mount.characterId,
      createdAt: current[idx].createdAt,
      updatedAt: new Date().toISOString(),
    };
    assertNoCycles(merged, await buildCyclePeers(mount, current));

    const next = current.slice();
    next[idx] = merged;
    await projectVaultWardrobe(mount.mountPointId, mount.characterId ?? mount.mountPointId, next);
    logger.debug('Wardrobe item updated in folder', {
      mountPointId: mount.mountPointId,
      scope: mount.scope,
      wardrobeItemId: id,
      context: 'wardrobe',
    });
    return merged;
  });
}

/** Delete an item from the folder; false when the id isn't there. */
export async function deleteInMount(mount: WardrobeMount, id: string): Promise<boolean> {
  return runSerialized(mount.mountPointId, async () => {
    const current = await readMountItems(mount);
    const next = current.filter((i) => i.id !== id);
    if (next.length === current.length) return false;
    await projectVaultWardrobe(mount.mountPointId, mount.characterId ?? mount.mountPointId, next);
    logger.debug('Wardrobe item deleted from folder', {
      mountPointId: mount.mountPointId,
      scope: mount.scope,
      wardrobeItemId: id,
      context: 'wardrobe',
    });
    return true;
  });
}

/** Create an item directly in a project or group store's `Wardrobe/` folder. */
export function createMountWardrobeItem(mountPointId: string, item: WardrobeItem): Promise<WardrobeItem> {
  return createInMount(mountWardrobeLocation(mountPointId), item);
}

/**
 * Patch an item addressed by mount alone. The restore pass uses this for every
 * tier: it addresses the folder by mount, and a vault's frontmatter carries no
 * characterId to disturb.
 */
export function updateMountWardrobeItem(
  mountPointId: string,
  id: string,
  patch: Partial<WardrobeItem>,
): Promise<WardrobeItem | null> {
  return updateInMount(mountWardrobeLocation(mountPointId), id, patch);
}

/** Delete an item directly from a project or group store's `Wardrobe/` folder. */
export function deleteMountWardrobeItem(mountPointId: string, id: string): Promise<boolean> {
  return deleteInMount(mountWardrobeLocation(mountPointId), id);
}

