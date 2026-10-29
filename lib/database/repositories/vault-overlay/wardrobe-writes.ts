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
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { isComposite } from '@/lib/schemas/wardrobe.types';
import { detectComponentCycles } from '@/lib/wardrobe/expand-composites';
import {
  isSafeWardrobeFolderPath,
  normalizeWardrobeFolderPathOrRoot,
  WardrobeFolderConflictError,
  WardrobeFolderNotFoundError,
  WardrobeFolderPathError,
  WardrobeItemNotInLocationError,
  WARDROBE_FOLDER_RULES,
  type WardrobeFolder,
} from '@/lib/wardrobe/folders';
import { hasStableWardrobeItemId, isWardrobeItemDocument } from './parsers';
import { readCharacterVaultWardrobe } from './vault-readers';
import { projectVaultWardrobe } from './wardrobe-sync';
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
  type VaultFolderMountScope,
} from './item-folder-ops';

/** The four wardrobe tiers. */
export type WardrobeMountScope = VaultFolderMountScope;

/** A wardrobe tier's folder on disk. */
export type WardrobeMount = VaultFolderMount;

function runSerialized<T>(mountPointId: string, fn: () => Promise<T>): Promise<T> {
  return runSerializedOnKey(chainKey(WARDROBE_FOLDER_RULES, mountPointId), fn);
}

/**
 * Resolve the folder for a character id, or Quilltap General for `null`.
 * Returns null when no mount is available (no linked vault, General not yet
 * provisioned). Throws `CharacterArchivedError` for an archived character: a
 * pruned vault is still live, so refusing here is what keeps the tombstone.
 * A delegate over the shared `resolveVaultFolderMount`.
 */
export function resolveWardrobeMount(
  characterId: string | null | undefined,
): Promise<WardrobeMount | null> {
  return resolveVaultFolderMount(characterId);
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

/**
 * The folder an item is written to: a structurally safe folder as given
 * (normal form, or a hand-made folder the store already holds), anything else
 * (an imported bundle's `../x`) normalised, or the root when it can't be. The
 * operator-facing paths resolve folders first (`resolveWardrobeFolder`); this
 * is the last line of defence for the ones that don't.
 */
function safeFolder(folder: string | null | undefined): string {
  if (!folder) return '';
  if (isSafeWardrobeFolderPath(folder)) return folder;
  const normalised = normalizeWardrobeFolderPathOrRoot(folder);
  logger.debug('Wardrobe write normalised an incoming folder', { folder, normalised, context: 'wardrobe' });
  return normalised;
}

/** Create an item in the folder. */
export async function createInMount(mount: WardrobeMount, item: WardrobeItem): Promise<WardrobeItem> {
  return runSerialized(mount.mountPointId, async () => {
    const current = await readMountItems(mount);
    assertNoCycles(item, await buildCyclePeers(mount, current));
    const stored: WardrobeItem = { ...item, folder: safeFolder(item.folder), characterId: mount.characterId };
    await projectVaultWardrobe(mount.mountPointId, mount.characterId ?? mount.mountPointId, [
      ...current,
      stored,
    ]);
    logger.debug('Wardrobe item created in folder', {
      mountPointId: mount.mountPointId,
      scope: mount.scope,
      wardrobeItemId: stored.id,
      folder: stored.folder,
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
  const [updated] = await updateManyInMount(mount, [{ id, patch }]);
  return updated ?? null;
}

/** One item's patch in an {@link updateManyInMount} batch. */
export interface WardrobeItemPatch {
  id: string;
  patch: Partial<WardrobeItem>;
}

/** Options for {@link updateManyInMount}. */
export interface UpdateManyOptions {
  /**
   * Refuse the whole batch — before anything is written — when any id isn't
   * in the folder (`WardrobeItemNotInLocationError`). Without it a missing id
   * is skipped.
   */
  requireAll?: boolean;
}

/**
 * Patch several items in the folder with one read and **one** projection.
 * Returns the updated items in patch order; an id that isn't in the folder is
 * skipped (or, with `requireAll`, refuses the batch).
 */
export async function updateManyInMount(
  mount: WardrobeMount,
  patches: readonly WardrobeItemPatch[],
  opts: UpdateManyOptions = {},
): Promise<WardrobeItem[]> {
  if (patches.length === 0) return [];
  return runSerialized(mount.mountPointId, () => updateManyUnserialized(mount, patches, opts));
}

/** The body of {@link updateManyInMount}, for callers already on the mount's chain. */
async function updateManyUnserialized(
  mount: WardrobeMount,
  patches: readonly WardrobeItemPatch[],
  opts: UpdateManyOptions = {},
): Promise<WardrobeItem[]> {
  const current = await readMountItems(mount);
  const indexById = new Map(current.map((item, idx) => [item.id, idx]));
  if (opts.requireAll) {
    const missing = patches.map((p) => p.id).filter((id) => !indexById.has(id));
    if (missing.length > 0) throw new WardrobeItemNotInLocationError(Array.from(new Set(missing)));
  }
  const next = current.slice();
  const now = new Date().toISOString();
  const updatedIds: string[] = [];
  let peers: Map<string, WardrobeItem> | null = null;
  let movesFolder = false;

  for (const { id, patch } of patches) {
    const idx = indexById.get(id);
    if (idx === undefined) continue;
    const before = next[idx];
    const merged: WardrobeItem = {
      ...before,
      ...patch,
      ...(patch.folder !== undefined && { folder: safeFolder(patch.folder) }),
      id: before.id,
      characterId: mount.characterId,
      createdAt: before.createdAt,
      updatedAt: now,
    };
    if (isComposite(merged)) {
      peers ??= await buildCyclePeers(mount, current);
      assertNoCycles(merged, peers);
    }
    if ((merged.folder ?? '') !== (before.folder ?? '')) movesFolder = true;
    next[idx] = merged;
    updatedIds.push(id);
  }
  if (updatedIds.length === 0) return [];

  await projectVaultWardrobe(mount.mountPointId, mount.characterId ?? mount.mountPointId, next);
  logger.debug('Wardrobe items updated in folder', {
    mountPointId: mount.mountPointId,
    scope: mount.scope,
    wardrobeItemIds: updatedIds,
    count: updatedIds.length,
    movesFolder,
    context: 'wardrobe',
  });

  return updatedIds.map((id) => next[indexById.get(id) as number]);
}

// ============================================================================
// Folders — the operator's filing under `Wardrobe/` (shared implementation
// in `item-folder-ops.ts`)
// ============================================================================

/** The wardrobe's folder tree, as the shared folder operations see it. */
const WARDROBE_TREE: ItemFolderTree<WardrobeItem> = {
  rules: WARDROBE_FOLDER_RULES,
  ext: '.md',
  context: 'wardrobe',
  isItemDocument: isWardrobeItemDocument,
  hasStableId: hasStableWardrobeItemId,
  read: readMountItems,
  reproject: (mount, items) =>
    projectVaultWardrobe(mount.mountPointId, mount.characterId ?? mount.mountPointId, items),
  refile: (mount, patches) =>
    updateManyUnserialized(
      mount,
      patches.map(({ id, folder }) => ({ id, patch: { folder } })),
    ),
  errors: {
    path: (message) => new WardrobeFolderPathError(message),
    notFound: (folder) => new WardrobeFolderNotFoundError(folder),
    conflict: (folder, message) => new WardrobeFolderConflictError(folder, message),
  },
};

/**
 * Every folder under the tier's `Wardrobe/`: the union of the store's folder
 * rows (empty folders persist as rows) and the folders implied by item paths,
 * minus `images/`. `itemCount` counts non-archived items directly inside.
 */
export function listFoldersInMount(mount: WardrobeMount): Promise<WardrobeFolder[]> {
  return listFoldersIn(WARDROBE_TREE, mount);
}

/**
 * The paths of every folder under the tier's `Wardrobe/`, from the store's
 * folder rows alone, minus `images/`: what `resolveWardrobeFolder` resolves
 * an operator's request against.
 */
export function listFolderPathsInMount(mount: WardrobeMount): Promise<string[]> {
  return listFolderPathsIn(WARDROBE_TREE, mount);
}

/** Create a folder (and its missing ancestors); idempotent and case-insensitive. */
export function createFolderInMount(mount: WardrobeMount, folder: string): Promise<WardrobeFolder> {
  return createFolderIn(WARDROBE_TREE, mount, folder);
}

/** Rename a folder in place; its items follow because the path is the truth. */
export function renameFolderInMount(
  mount: WardrobeMount,
  folder: string,
  newName: string,
): Promise<WardrobeFolder> {
  return renameFolderIn(WARDROBE_TREE, mount, folder, newName);
}

/**
 * Delete a folder, sending everything in it up one level. A folder holding
 * files that are not wardrobe items (a picture, a nested `instructions.md`, a
 * `.txt`) is refused before anything moves.
 */
export function deleteFolderInMount(
  mount: WardrobeMount,
  folder: string,
): Promise<{ movedItems: number; movedFolders: number; parent: string }> {
  return deleteFolderIn(WARDROBE_TREE, mount, folder);
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

