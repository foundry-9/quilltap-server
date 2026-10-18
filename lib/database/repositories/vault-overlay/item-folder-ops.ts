/**
 * Item-folder operations — the folder half of every "folder of item files"
 * tier: the wardrobe's `Wardrobe/` and the Inventory's `Inventory/`.
 *
 * Listing, creating, renaming and deleting folders is the same work whatever
 * the items are: the path is the truth, empty folders persist as store rows,
 * a rename is a store folder move, and a delete sends everything up a level.
 * What differs per tier — the root, the item predicate, the reader and the
 * projection — is an {@link ItemFolderTree} descriptor, so both tiers call
 * one implementation rather than each keeping a copy.
 *
 * Also here: the per-folder write chain ({@link runSerialized}) every item
 * writer uses, and the one tombstone-aware mount resolver
 * ({@link resolveVaultFolderMount}).
 *
 * @module database/repositories/vault-overlay/item-folder-ops
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { CharacterArchivedError } from '../characters.repository';
import {
  folderName,
  folderSegments,
  folderUnderItemRoot,
  isSameFolder,
  isUnderFolder,
  itemFolderStorePath,
  joinFolder,
  parentFolder,
  rebaseFolder,
  type ItemFolder,
  type ItemFolderRules,
} from '@/lib/mount-index/item-folders';
import {
  DatabaseStoreError,
  deleteDatabaseFolder,
  moveDatabaseFolder,
} from '@/lib/mount-index/database-store';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';

/** The four tiers a vault folder can belong to. */
export type VaultFolderMountScope = 'character' | 'group' | 'project' | 'general';

/** One tier's folder on disk. */
export interface VaultFolderMount {
  mountPointId: string;
  scope: VaultFolderMountScope;
  /** Owning character for the `character` scope; null for every shared tier. */
  characterId: string | null;
}

/** What every filed item carries. */
export interface FiledItem {
  id: string;
  folder?: string | null;
  archivedAt?: string | null;
}

/** A tier's description of its folder of items. */
export interface ItemFolderTree<T extends FiledItem> {
  rules: ItemFolderRules;
  /** The item files' extension, e.g. `.md`. */
  ext: string;
  /** The `context` field on log lines. */
  context: string;
  /** True for a document this tier owns (and may sweep or move). */
  isItemDocument(doc: { relativePath: string; content?: string | null }): boolean;
  /** True when a file carries its own id (moving it keeps its identity). */
  hasStableId(content: string | null | undefined): boolean;
  /** Every item in the folder, archived included. */
  read(mount: VaultFolderMount): Promise<T[]>;
  /** Re-project the folder from an authoritative list. */
  reproject(mount: VaultFolderMount, items: readonly T[]): Promise<void>;
  /** Re-file items with one projection; the caller is already on the chain. */
  refile(mount: VaultFolderMount, patches: Array<{ id: string; folder: string }>): Promise<unknown>;
  errors: {
    path(message: string): Error;
    notFound(folder: string): Error;
    conflict(folder: string, message?: string): Error;
  };
}

// Per-folder serialization so concurrent writes don't read a stale folder.
const writeChains = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after every earlier write queued on `key` (one key per tier folder,
 * e.g. `Wardrobe:<mountPointId>`). Never call it again with the same key from
 * inside `fn` — that would wait on itself.
 */
export function runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  writeChains.set(key, next);
  void next
    .catch(() => {})
    .finally(() => {
      if (writeChains.get(key) === next) writeChains.delete(key);
    });
  return next;
}

/** The write-chain key for one tier folder. */
export function chainKey(rules: ItemFolderRules, mountPointId: string): string {
  return `${rules.root}:${mountPointId}`;
}

/**
 * Resolve the vault-folder mount for a character id, or Quilltap General for
 * `null`. Returns null when no mount is available (no linked vault, General
 * not yet provisioned). Throws `CharacterArchivedError` for an archived
 * character: a pruned vault is still live, so refusing here is what keeps the
 * tombstone. The mount is the same whatever folder is wanted; each tier
 * names its own folder through its rules.
 */
export async function resolveVaultFolderMount(
  characterId: string | null | undefined,
): Promise<VaultFolderMount | null> {
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

/**
 * Every folder under the tier's root: the union of the store's folder rows
 * (empty folders persist as rows) and the folders implied by item paths,
 * minus reserved ones. `itemCount` counts non-archived items directly inside.
 * Sorted by path, case-insensitively.
 */
export async function listFoldersIn<T extends FiledItem>(
  tree: ItemFolderTree<T>,
  mount: VaultFolderMount,
): Promise<ItemFolder[]> {
  const repos = getRepositories();
  const [rows, items] = await Promise.all([
    repos.docMountFolders.findByMountPointId(mount.mountPointId),
    tree.read(mount),
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
    const folder = folderUnderItemRoot(tree.rules, row.path);
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
  logger.debug(`${tree.rules.root} folders listed`, {
    mountPointId: mount.mountPointId,
    scope: mount.scope,
    folderRowCount: rows.length,
    folderCount: folders.length,
    context: tree.context,
  });
  return folders;
}

/**
 * The paths of every folder under the tier's root, from the store's folder
 * rows alone, minus reserved ones. One query, no item parse.
 */
export async function listFolderPathsIn<T extends FiledItem>(
  tree: ItemFolderTree<T>,
  mount: VaultFolderMount,
): Promise<string[]> {
  const rows = await getRepositories().docMountFolders.findByMountPointId(mount.mountPointId);
  return rows
    .map((row) => folderUnderItemRoot(tree.rules, row.path))
    .filter((folder): folder is string => folder !== null);
}

/** The stored casing of a folder that exists, or null. */
async function findStoredFolder(rules: ItemFolderRules, mountPointId: string, folder: string): Promise<string | null> {
  const row = await getRepositories().docMountFolders.findByMountPointAndPath(
    mountPointId,
    itemFolderStorePath(rules, folder),
  );
  return row ? folderUnderItemRoot(rules, row.path) : null;
}

/**
 * Create a folder (and its missing ancestors). Idempotent and
 * case-insensitive: creating `formal` beside `Formal` answers `Formal`.
 * `folder` must already be normalised.
 */
export async function createFolderIn<T extends FiledItem>(
  tree: ItemFolderTree<T>,
  mount: VaultFolderMount,
  folder: string,
): Promise<ItemFolder> {
  if (!folder) throw tree.errors.path(`The ${tree.rules.noun} root already exists`);
  return runSerialized(chainKey(tree.rules, mount.mountPointId), async () => {
    await ensureFolderPath(mount.mountPointId, itemFolderStorePath(tree.rules, folder));
    const stored = (await findStoredFolder(tree.rules, mount.mountPointId, folder)) ?? folder;
    const items = await tree.read(mount);
    const itemCount = items.filter((i) => !i.archivedAt && isSameFolder(i.folder, stored)).length;
    logger.debug(`${tree.rules.root} folder ensured`, {
      mountPointId: mount.mountPointId,
      scope: mount.scope,
      requested: folder,
      folder: stored,
      itemCount,
      context: tree.context,
    });
    return { path: stored, name: folderName(stored), itemCount };
  });
}

/**
 * Rename a folder in place (`newName` is one normalised segment). Its items,
 * subfolders and any other files move with it — the path is the truth, so
 * every item's `folder` follows. A sibling already holding the name (in any
 * casing) is a conflict; a case-only rename is allowed.
 */
export async function renameFolderIn<T extends FiledItem>(
  tree: ItemFolderTree<T>,
  mount: VaultFolderMount,
  folder: string,
  newName: string,
): Promise<ItemFolder> {
  if (!folder) throw tree.errors.path(`The ${tree.rules.noun} root cannot be renamed`);
  return runSerialized(chainKey(tree.rules, mount.mountPointId), async () => {
    const from = await findStoredFolder(tree.rules, mount.mountPointId, folder);
    if (!from) throw tree.errors.notFound(folder);
    const to = joinFolder(parentFolder(from), newName);
    if (to !== from) {
      // The store moves the files without rewriting them, and an item file
      // without its own id takes its id from its path — moving it would mint
      // a new one and orphan everything that names it. Stamp every such file
      // with the id it has now, first.
      const docs = await getRepositories().docMountDocuments.findManyByMountPointsInFolder(
        [mount.mountPointId],
        itemFolderStorePath(tree.rules, from),
        tree.ext,
        { recursive: true },
      );
      const unstamped = docs.filter((doc) => tree.isItemDocument(doc) && !tree.hasStableId(doc.content));
      if (unstamped.length > 0) {
        logger.debug(`Stamping ids into ${tree.rules.noun} files before a folder rename`, {
          mountPointId: mount.mountPointId,
          folder: from,
          count: unstamped.length,
          context: tree.context,
        });
        await tree.reproject(mount, await tree.read(mount));
      }
      try {
        await moveDatabaseFolder(
          mount.mountPointId,
          itemFolderStorePath(tree.rules, from),
          itemFolderStorePath(tree.rules, to),
        );
      } catch (error) {
        if (error instanceof DatabaseStoreError && error.code === 'CONFLICT') {
          throw tree.errors.conflict(to);
        }
        if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
          throw tree.errors.notFound(folder);
        }
        throw error;
      }
    }
    const items = await tree.read(mount);
    const itemCount = items.filter((i) => !i.archivedAt && isSameFolder(i.folder, to)).length;
    logger.debug(`${tree.rules.root} folder renamed`, {
      mountPointId: mount.mountPointId,
      scope: mount.scope,
      from,
      to,
      itemCount,
      context: tree.context,
    });
    return { path: to, name: folderName(to), itemCount };
  });
}

/**
 * Delete a folder, sending everything in it up one level: its items (archived
 * included) to the parent, its subfolders to sit beside it — merging into a
 * same-named folder there, case-insensitively. Nothing is deleted but folder
 * rows. A folder holding files that are not this tier's items (a picture, a
 * note) is refused before anything moves.
 */
export async function deleteFolderIn<T extends FiledItem>(
  tree: ItemFolderTree<T>,
  mount: VaultFolderMount,
  folder: string,
): Promise<{ movedItems: number; movedFolders: number; parent: string }> {
  const { rules } = tree;
  if (!folder) throw tree.errors.path(`The ${rules.noun} root cannot be deleted`);
  return runSerialized(chainKey(rules, mount.mountPointId), async () => {
    const repos = getRepositories();
    const from = await findStoredFolder(rules, mount.mountPointId, folder);
    if (!from) throw tree.errors.notFound(folder);
    const parent = parentFolder(from);
    const storeFrom = itemFolderStorePath(rules, from);
    const storePrefix = `${storeFrom}/`.toLowerCase();

    // Everything is checked before anything moves, so a refusal leaves the
    // tier exactly as it was.
    //
    // 1. Files the tier doesn't own — a picture, a `.txt`, a note (the
    //    projection never sweeps those, so the folder could not empty).
    const links = (await repos.docMountFileLinks.findByMountPointId(mount.mountPointId)).filter(
      (link) => link.relativePath.toLowerCase().startsWith(storePrefix),
    );
    const docsByPath = new Map(
      (
        await repos.docMountDocuments.findManyByMountPointsInFolder(
          [mount.mountPointId],
          storeFrom,
          tree.ext,
          { recursive: true },
        )
      ).map((doc) => [doc.relativePath.toLowerCase(), doc]),
    );
    const strays = links.filter((link) => {
      const doc = docsByPath.get(link.relativePath.toLowerCase());
      return !doc || !tree.isItemDocument(doc);
    });
    if (strays.length > 0) {
      throw tree.errors.conflict(
        from,
        `Folder "${from}" holds ${strays.length} file(s) that are not ${rules.noun} items; move them in the Scriptorium first`,
      );
    }

    // 2. A subfolder sharing the folder's own name (`Formal/Formal`) would be
    //    sent up into the very place being removed.
    const rows = (await repos.docMountFolders.findByMountPointId(mount.mountPointId))
      .filter((row) => row.path.toLowerCase().startsWith(storePrefix))
      .sort((a, b) => b.path.length - a.path.length);
    const items = await tree.read(mount);
    const moving = items.filter((item) => isUnderFolder(item.folder ?? '', from));
    const landsInside = [
      ...moving.map((item) => item.folder ?? ''),
      ...rows.map((row) => folderUnderItemRoot(rules, row.path) ?? ''),
    ].some((sub) => sub && isUnderFolder(rebaseFolder(sub, from, parent), from));
    if (landsInside) {
      throw tree.errors.conflict(
        from,
        `Folder "${from}" holds a subfolder of the same name; rename one of them first`,
      );
    }

    // Items: one batch, one projection. Each is re-rooted from under the
    // folder to under its parent, so subfolder contents keep their shape.
    if (moving.length > 0) {
      await tree.refile(
        mount,
        moving.map((item) => ({ id: item.id, folder: rebaseFolder(item.folder ?? '', from, parent) })),
      );
    }

    // Subfolders: re-create each (empty ones included) under the parent,
    // then drop the old rows deepest first.
    for (const row of rows) {
      const sub = folderUnderItemRoot(rules, row.path);
      if (!sub) continue;
      await ensureFolderPath(mount.mountPointId, itemFolderStorePath(rules, rebaseFolder(sub, from, parent)));
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
        throw tree.errors.conflict(from, `Folder "${from}" is not empty yet; its items were moved up`);
      }
      throw error;
    }

    // The subfolders that moved up are the folder's direct children.
    const childDepth = folderSegments(from).length + 1;
    const movedFolders = rows.filter(
      (row) => folderSegments(folderUnderItemRoot(rules, row.path) ?? '').length === childDepth,
    ).length;
    logger.debug(`${rules.root} folder deleted; contents sent up`, {
      mountPointId: mount.mountPointId,
      scope: mount.scope,
      folder: from,
      parent,
      movedItems: moving.length,
      movedFolders,
      context: tree.context,
    });
    return { movedItems: moving.length, movedFolders, parent };
  });
}
