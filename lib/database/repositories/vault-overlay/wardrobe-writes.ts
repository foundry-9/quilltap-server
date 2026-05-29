/**
 * Vault-first wardrobe writes.
 *
 * Post-cutover the per-character document vault (and the singleton "Quilltap
 * General" mount, for shared archetypes) is the *write* target for wardrobe
 * items — the `wardrobe_items` DB table is no longer written. Each mutation
 * reads the target folder's current items, applies the change in memory, and
 * re-projects the whole `Wardrobe/` folder via `projectVaultWardrobe` (which
 * dedupes filenames, renames on title change, and sweeps removed files).
 *
 * Writes to a given mount are serialized through a per-mount promise chain so
 * two concurrent mutations can't each read a stale snapshot and clobber one
 * another — the same guard the old DB→vault sync used per character.
 *
 * Every helper returns a discriminated result so the repository can fall back
 * to the legacy DB path when no vault mount resolves (e.g. the General mount
 * hasn't been provisioned yet on a freshly-cloned instance).
 *
 * @module database/repositories/vault-overlay/wardrobe-writes
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { detectComponentCycles } from '@/lib/wardrobe/expand-composites';
import { readCharacterVaultWardrobe } from './vault-readers';
import { projectVaultWardrobe } from './wardrobe-sync';

/** Where a wardrobe item's files live: a character vault or Quilltap General. */
export interface WardrobeLocation {
  mountPointId: string;
  /** Logging/parse scope passed to the projector and reader. */
  scopeId: string;
  /** null = shared archetype (lives in Quilltap General). */
  characterId: string | null;
}

/** `{ handled: false }` ⇒ no vault mount resolved; caller should use the DB fallback. */
export type VaultWriteResult<T> = { handled: true; value: T } | { handled: false };

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
 * Resolve the mount + scope for a characterId. `null` → Quilltap General
 * (shared archetypes). Returns null when no vault is available (character has
 * no linked vault, or General not yet provisioned) — callers fall back to DB.
 */
export async function resolveWardrobeMount(
  characterId: string | null | undefined,
): Promise<WardrobeLocation | null> {
  if (characterId == null) {
    const mountPointId = await getGeneralMountPointId();
    if (!mountPointId) return null;
    return { mountPointId, scopeId: mountPointId, characterId: null };
  }
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  const mountPointId = character?.characterDocumentMountPointId;
  if (!mountPointId) return null;
  return { mountPointId, scopeId: characterId, characterId };
}

/** Read every item (incl. archived) currently in the location's `Wardrobe/` folder. */
async function readMountItems(loc: WardrobeLocation): Promise<WardrobeItem[]> {
  const vault = await readCharacterVaultWardrobe(loc.mountPointId, loc.scopeId, {
    // The General folder IS the archetype set, so it must not re-seed archetypes.
    seedArchetypes: loc.characterId !== null,
  });
  if (!vault) return [];
  return vault.items.map((item) => ({ ...item, characterId: loc.characterId }));
}

/**
 * Build the id→item map used for cycle detection: the location's current items
 * plus, for a character mount, the shared archetypes (a character composite may
 * bundle an archetype component).
 */
async function buildCyclePeers(
  loc: WardrobeLocation,
  current: readonly WardrobeItem[],
): Promise<Map<string, WardrobeItem>> {
  const map = new Map<string, WardrobeItem>();
  for (const item of current) map.set(item.id, item);
  if (loc.characterId !== null) {
    try {
      const { readGeneralWardrobe } = await import('@/lib/mount-index/general-wardrobe');
      for (const arche of await readGeneralWardrobe(true)) {
        if (!map.has(arche.id)) map.set(arche.id, arche);
      }
    } catch {
      /* archetypes unavailable — cycle check proceeds with local items only */
    }
  }
  return map;
}

function assertNoCycles(item: WardrobeItem, peers: Map<string, WardrobeItem>): void {
  if (item.componentItemIds.length === 0) return;
  // Ensure the item itself is in the map so transitive walks see its components.
  peers.set(item.id, item);
  const cycles = detectComponentCycles(item.id, item.componentItemIds, peers);
  if (cycles.length > 0) {
    throw new Error(
      `Wardrobe item ${item.id} would create a component cycle: ${cycles
        .map((c) => c.join(' → '))
        .join('; ')}`,
    );
  }
}

/** Create an item in its resolved vault folder. */
export async function createVaultWardrobeItem(
  item: WardrobeItem,
): Promise<VaultWriteResult<WardrobeItem>> {
  const loc = await resolveWardrobeMount(item.characterId ?? null);
  if (!loc) return { handled: false };

  return {
    handled: true,
    value: await runSerialized(loc.mountPointId, async () => {
      const current = await readMountItems(loc);
      assertNoCycles(item, await buildCyclePeers(loc, current));
      await projectVaultWardrobe(loc.mountPointId, loc.scopeId, [...current, item]);
      logger.debug('[WardrobeWrites] Created item in vault', {
        itemId: item.id,
        characterId: loc.characterId,
        mountPointId: loc.mountPointId,
        title: item.title,
        context: 'wardrobe',
      });
      return item;
    }),
  };
}

/**
 * Update an item. `characterIdHint` (the owning character, or null for an
 * archetype) locates the mount; without it we cannot cheaply find the item, so
 * the repository must pass it. Returns `{ handled: true, value: null }` when the
 * id isn't present in the resolved folder.
 */
export async function updateVaultWardrobeItem(
  id: string,
  patch: Partial<WardrobeItem>,
  characterIdHint: string | null,
): Promise<VaultWriteResult<WardrobeItem | null>> {
  const loc = await resolveWardrobeMount(characterIdHint);
  if (!loc) return { handled: false };

  return {
    handled: true,
    value: await runSerialized(loc.mountPointId, async () => {
      const current = await readMountItems(loc);
      const idx = current.findIndex((i) => i.id === id);
      if (idx < 0) return null;

      const merged: WardrobeItem = {
        ...current[idx],
        ...patch,
        id: current[idx].id,
        characterId: loc.characterId,
        createdAt: current[idx].createdAt,
        updatedAt: new Date().toISOString(),
      };
      assertNoCycles(merged, await buildCyclePeers(loc, current));

      const next = current.slice();
      next[idx] = merged;
      await projectVaultWardrobe(loc.mountPointId, loc.scopeId, next);
      logger.debug('[WardrobeWrites] Updated item in vault', {
        itemId: id,
        characterId: loc.characterId,
        mountPointId: loc.mountPointId,
        context: 'wardrobe',
      });
      return merged;
    }),
  };
}

/** Delete an item from its resolved vault folder. */
export async function deleteVaultWardrobeItem(
  id: string,
  characterIdHint: string | null,
): Promise<VaultWriteResult<boolean>> {
  const loc = await resolveWardrobeMount(characterIdHint);
  if (!loc) return { handled: false };

  return {
    handled: true,
    value: await runSerialized(loc.mountPointId, async () => {
      const current = await readMountItems(loc);
      const next = current.filter((i) => i.id !== id);
      if (next.length === current.length) return false;
      await projectVaultWardrobe(loc.mountPointId, loc.scopeId, next);
      logger.debug('[WardrobeWrites] Deleted item from vault', {
        itemId: id,
        characterId: loc.characterId,
        mountPointId: loc.mountPointId,
        context: 'wardrobe',
      });
      return true;
    }),
  };
}
