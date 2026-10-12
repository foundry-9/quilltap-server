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
import {
  folderName,
  folderSegments,
  isSameFolder,
  isUnderFolder,
  isSafeWardrobeFolderPath,
  joinFolder,
  normalizeWardrobeFolderPathOrRoot,
  parentFolder,
  rebaseFolder,
  wardrobeFolderStorePath,
  WardrobeFolderConflictError,
  WardrobeFolderNotFoundError,
  WardrobeFolderPathError,
  WardrobeItemNotInLocationError,
  WARDROBE_RESERVED_FOLDER_SEGMENTS,
  type WardrobeFolder,
} from '@/lib/wardrobe/folders';
import {
  DatabaseStoreError,
  deleteDatabaseFolder,
  moveDatabaseFolder,
} from '@/lib/mount-index/database-store';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { hasStableWardrobeItemId, isWardrobeItemDocument } from './parsers';
import { CHARACTER_WARDROBE_FOLDER } from './schema';
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
// Folders — the operator's filing under `Wardrobe/`
// ============================================================================

/**
 * Every folder under the tier's `Wardrobe/`: the union of the store's folder
 * rows (empty folders persist as rows) and the folders implied by item paths,
 * minus `images/`. `itemCount` counts non-archived items directly inside.
 * Sorted by path, case-insensitively.
 */
export async function listFoldersInMount(mount: WardrobeMount): Promise<WardrobeFolder[]> {
  const repos = getRepositories();
  const [rows, items] = await Promise.all([
    repos.docMountFolders.findByMountPointId(mount.mountPointId),
    readMountItems(mount),
  ]);

  const byKey = new Map<string, string>();
  const add = (folder: string) => {
    // Every ancestor is a folder too, even when only a deep path has a row.
    const segments = folderSegments(folder);
    for (let depth = 1; depth <= segments.length; depth++) {
      const path = segments.slice(0, depth).join('/');
      if (!byKey.has(path.toLowerCase())) byKey.set(path.toLowerCase(), path);
    }
  };
  for (const row of rows) {
    const folder = folderUnderWardrobe(row.path);
    if (folder) add(folder);
  }
  for (const item of items) {
    if (item.folder) add(item.folder);
  }

  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.archivedAt || !item.folder) continue;
    const key = item.folder.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const folders = Array.from(byKey.entries())
    .map(([key, path]) => ({ path, name: folderName(path), itemCount: counts.get(key) ?? 0 }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  logger.debug('Wardrobe folders listed', {
    mountPointId: mount.mountPointId,
    scope: mount.scope,
    folderRowCount: rows.length,
    folderCount: folders.length,
    context: 'wardrobe',
  });
  return folders;
}

/**
 * The paths of every folder under the tier's `Wardrobe/`, from the store's
 * folder rows alone (every item's folder has one — writes create them), minus
 * `images/`. One query, no item parse: what `resolveWardrobeFolder` resolves
 * an operator's request against.
 */
export async function listFolderPathsInMount(mount: WardrobeMount): Promise<string[]> {
  const rows = await getRepositories().docMountFolders.findByMountPointId(mount.mountPointId);
  return rows
    .map((row) => folderUnderWardrobe(row.path))
    .filter((folder): folder is string => folder !== null);
}

/**
 * The folder path under `Wardrobe/` for a store folder path, or null when the
 * path is `Wardrobe` itself, outside it, or under the reserved `images/`.
 */
function folderUnderWardrobe(storePath: string): string | null {
  const prefix = `${CHARACTER_WARDROBE_FOLDER}/`;
  if (!storePath.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const folder = storePath.slice(prefix.length);
  if (!folder) return null;
  const first = folderSegments(folder)[0].toLowerCase();
  if (WARDROBE_RESERVED_FOLDER_SEGMENTS.includes(first)) return null;
  return folder;
}

/** The stored casing of a folder that exists, or null. */
async function findStoredFolder(mountPointId: string, folder: string): Promise<string | null> {
  const row = await getRepositories().docMountFolders.findByMountPointAndPath(
    mountPointId,
    wardrobeFolderStorePath(folder),
  );
  return row ? folderUnderWardrobe(row.path) : null;
}

/**
 * Create a folder (and its missing ancestors). Idempotent and
 * case-insensitive: creating `formal` beside `Formal` answers `Formal`.
 * `folder` must already be normalised.
 */
export async function createFolderInMount(mount: WardrobeMount, folder: string): Promise<WardrobeFolder> {
  if (!folder) throw new WardrobeFolderPathError('The wardrobe root already exists');
  return runSerialized(mount.mountPointId, async () => {
    await ensureFolderPath(mount.mountPointId, wardrobeFolderStorePath(folder));
    const stored = (await findStoredFolder(mount.mountPointId, folder)) ?? folder;
    const items = await readMountItems(mount);
    const itemCount = items.filter((i) => !i.archivedAt && isSameFolder(i.folder, stored)).length;
    logger.debug('Wardrobe folder ensured', {
      mountPointId: mount.mountPointId,
      scope: mount.scope,
      requested: folder,
      folder: stored,
      itemCount,
      context: 'wardrobe',
    });
    return { path: stored, name: folderName(stored), itemCount };
  });
}

/**
 * Rename a folder in place (`newName` is one normalised segment). Its items,
 * subfolders and any other files move with it — the path is the truth, so
 * every item's `folder` follows. A sibling already holding the name (in any
 * casing) is a {@link WardrobeFolderConflictError}; a case-only rename is
 * allowed.
 */
export async function renameFolderInMount(
  mount: WardrobeMount,
  folder: string,
  newName: string,
): Promise<WardrobeFolder> {
  if (!folder) throw new WardrobeFolderPathError('The wardrobe root cannot be renamed');
  return runSerialized(mount.mountPointId, async () => {
    const from = await findStoredFolder(mount.mountPointId, folder);
    if (!from) throw new WardrobeFolderNotFoundError(folder);
    const to = joinFolder(parentFolder(from), newName);
    if (to !== from) {
      // The store moves the files without rewriting them, and an item file
      // with no frontmatter `id` takes its id from its path — moving it would
      // mint a new one and orphan its outfit slots, ledger, outfits and
      // pictures. Stamp every such file with the id it has now, first.
      const docs = await getRepositories().docMountDocuments.findManyByMountPointsInFolder(
        [mount.mountPointId],
        wardrobeFolderStorePath(from),
        '.md',
        { recursive: true },
      );
      const unstamped = docs.filter(
        (doc) => isWardrobeItemDocument(doc) && !hasStableWardrobeItemId(doc.content),
      );
      if (unstamped.length > 0) {
        logger.debug('Stamping ids into wardrobe files before a folder rename', {
          mountPointId: mount.mountPointId,
          folder: from,
          count: unstamped.length,
          context: 'wardrobe',
        });
        await projectVaultWardrobe(
          mount.mountPointId,
          mount.characterId ?? mount.mountPointId,
          await readMountItems(mount),
        );
      }
      try {
        await moveDatabaseFolder(
          mount.mountPointId,
          wardrobeFolderStorePath(from),
          wardrobeFolderStorePath(to),
        );
      } catch (error) {
        if (error instanceof DatabaseStoreError && error.code === 'CONFLICT') {
          throw new WardrobeFolderConflictError(to);
        }
        if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
          throw new WardrobeFolderNotFoundError(folder);
        }
        throw error;
      }
    }
    const items = await readMountItems(mount);
    const itemCount = items.filter((i) => !i.archivedAt && isSameFolder(i.folder, to)).length;
    logger.debug('Wardrobe folder renamed', {
      mountPointId: mount.mountPointId,
      scope: mount.scope,
      from,
      to,
      itemCount,
      context: 'wardrobe',
    });
    return { path: to, name: folderName(to), itemCount };
  });
}

/**
 * Delete a folder, sending everything in it up one level: its items (archived
 * included) to the parent, its subfolders to sit beside it — merging into a
 * same-named folder there, case-insensitively. Nothing is deleted but folder
 * rows. A folder holding files that are not wardrobe items (a picture, a
 * nested `instructions.md`, a `.txt`) is refused before anything moves.
 */
export async function deleteFolderInMount(
  mount: WardrobeMount,
  folder: string,
): Promise<{ movedItems: number; movedFolders: number; parent: string }> {
  if (!folder) throw new WardrobeFolderPathError('The wardrobe root cannot be deleted');
  return runSerialized(mount.mountPointId, async () => {
    const repos = getRepositories();
    const from = await findStoredFolder(mount.mountPointId, folder);
    if (!from) throw new WardrobeFolderNotFoundError(folder);
    const parent = parentFolder(from);
    const storeFrom = wardrobeFolderStorePath(from);
    const storePrefix = `${storeFrom}/`.toLowerCase();

    // Everything is checked before anything moves, so a refusal leaves the
    // wardrobe exactly as it was.
    //
    // 1. Files the wardrobe doesn't own — a picture, a `.txt`, a note or a
    //    nested `instructions.md` (the projection never sweeps those, so the
    //    folder could not empty).
    const links = (await repos.docMountFileLinks.findByMountPointId(mount.mountPointId)).filter(
      (link) => link.relativePath.toLowerCase().startsWith(storePrefix),
    );
    const docsByPath = new Map(
      (
        await repos.docMountDocuments.findManyByMountPointsInFolder(
          [mount.mountPointId],
          storeFrom,
          '.md',
          { recursive: true },
        )
      ).map((doc) => [doc.relativePath.toLowerCase(), doc]),
    );
    const strays = links.filter((link) => {
      const doc = docsByPath.get(link.relativePath.toLowerCase());
      return !doc || !isWardrobeItemDocument(doc);
    });
    if (strays.length > 0) {
      throw new WardrobeFolderConflictError(
        from,
        `Folder "${from}" holds ${strays.length} file(s) that are not wardrobe items; move them in the Scriptorium first`,
      );
    }

    // 2. A subfolder sharing the folder's own name (`Formal/Formal`) would be
    //    sent up into the very place being removed.
    const rows = (await repos.docMountFolders.findByMountPointId(mount.mountPointId))
      .filter((row) => row.path.toLowerCase().startsWith(storePrefix))
      .sort((a, b) => b.path.length - a.path.length);
    const items = await readMountItems(mount);
    const moving = items.filter((item) => isUnderFolder(item.folder ?? '', from));
    const landsInside = [
      ...moving.map((item) => item.folder ?? ''),
      ...rows.map((row) => folderUnderWardrobe(row.path) ?? ''),
    ].some((sub) => sub && isUnderFolder(rebaseFolder(sub, from, parent), from));
    if (landsInside) {
      throw new WardrobeFolderConflictError(
        from,
        `Folder "${from}" holds a subfolder of the same name; rename one of them first`,
      );
    }

    // Items: one batch, one projection. Each is re-rooted from under the
    // folder to under its parent, so subfolder contents keep their shape.
    if (moving.length > 0) {
      await updateManyUnserialized(
        mount,
        moving.map((item) => ({
          id: item.id,
          patch: { folder: rebaseFolder(item.folder ?? '', from, parent) },
        })),
      );
    }

    // Subfolders: re-create each (empty ones included) under the parent,
    // then drop the old rows deepest first.
    for (const row of rows) {
      const sub = folderUnderWardrobe(row.path);
      if (!sub) continue;
      await ensureFolderPath(mount.mountPointId, wardrobeFolderStorePath(rebaseFolder(sub, from, parent)));
    }
    try {
      for (const row of rows) {
        await deleteDatabaseFolder(mount.mountPointId, row.path);
      }
      await deleteDatabaseFolder(mount.mountPointId, storeFrom);
    } catch (error) {
      // The checks above should make this unreachable; if a file arrived in
      // the meantime, say so as a conflict rather than a 500.
      if (error instanceof DatabaseStoreError && error.code === 'NOT_EMPTY') {
        throw new WardrobeFolderConflictError(from, `Folder "${from}" is not empty yet; its items were moved up`);
      }
      throw error;
    }

    // The subfolders that moved up are the folder's direct children.
    const childDepth = folderSegments(from).length + 1;
    const movedFolders = rows.filter(
      (row) => folderSegments(folderUnderWardrobe(row.path) ?? '').length === childDepth,
    ).length;
    logger.debug('Wardrobe folder deleted; contents sent up', {
      mountPointId: mount.mountPointId,
      scope: mount.scope,
      folder: from,
      parent,
      movedItems: moving.length,
      movedFolders,
      context: 'wardrobe',
    });
    return { movedItems: moving.length, movedFolders, parent };
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

