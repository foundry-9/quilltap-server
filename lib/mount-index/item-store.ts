/**
 * The item-store kernel — what the Wardrobe, the Inventory and the Atlas share
 * beneath their own rules (Refactor 4.13, item-family kernel).
 *
 * Each family keeps its chokepoint files (`location.ts`, `vault-writes.ts`,
 * `item-mutations.ts`, `pool.ts`) as thin bindings over this module:
 *
 * - {@link readTiers} reads the tiers of a reach and says what it could not
 *   read; {@link shadowLayers} shadows them, strongest first, first wins.
 * - {@link foldItemName} is the one name fold used for identity.
 * - {@link createItemFolderStore} is the writer a family binds with its
 *   serialiser: create, batched update, delete, the folder operations and
 *   the location write wrapper, every write serialised per folder.
 * - {@link archivedPatch} and {@link nextCopyTitle} are the small rules all
 *   three families share.
 *
 * **A whole-set rewrite never treats "unread" as "gone"** (#186): a reader
 * that rewrites a stored set from a pool consults {@link TierReads.unread}
 * before pruning what the pool could not resolve.
 *
 * Server-only.
 *
 * @module lib/mount-index/item-store
 */

import { logger } from '@/lib/logger';
import { publishRealtime } from '@/lib/realtime/bus';
import {
  isSafeItemFolderPath,
  normalizeItemFolderPathOrRoot,
  type ItemFolder,
  type ItemFolderRules,
} from '@/lib/mount-index/item-folders';
import {
  chainKey,
  createFolderIn,
  deleteFolderIn,
  listFolderPathsIn,
  listFoldersIn,
  renameFolderIn,
  resolveVaultFolderMount,
  runSerialized,
  type ItemFolderTree,
  type VaultFolderMount,
} from '@/lib/mount-index/item-folder-ops';
import { projectArrayIntoVaultFolder } from '@/lib/mount-index/vault-projection';
import type { ItemFamilyKind } from '@/lib/mount-index/item-tiers';

// ============================================================================
// Tier reads (`item-tiers.ts`, so a pool does not load the writer)
// ============================================================================

export {
  readTiers,
  shadowLayers,
  type ItemFamilyKind,
  type TierReads,
  type TierSpec,
  type UnreadMount,
} from '@/lib/mount-index/item-tiers';

// ============================================================================
// Names (client-safe; `item-names.ts`)
// ============================================================================

export { foldItemName } from '@/lib/mount-index/item-names';

// ============================================================================
// The folder store
// ============================================================================

/** What every stored item carries. */
export interface StoredItem {
  id: string;
  folder?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One parse of a family's folder. */
export interface ItemFolderScan<T> {
  /** Every record, archived included; the first file to claim an id wins it. */
  records: T[];
  /** Files that parse as records but lose to another claiming the same id: never swept. */
  duplicatePaths: Set<string>;
  /** The files that became `records`: the only ones a projection may sweep. */
  ownedPaths: Set<string>;
}

/** One record's change in a batch: fields to set, and stored keys to remove. */
export interface ItemPatch<T> {
  id: string;
  patch: Partial<T>;
  remove?: readonly string[];
}

/**
 * A check run inside the folder's write chain against the records as they
 * are now, before anything is written; it throws to refuse. What makes a
 * read-then-write rule (a free name) hold under concurrent writers.
 */
export type ItemWriteGuard<T> = (records: readonly T[]) => void;

/** The four folder errors a family's routes map to statuses. */
export interface ItemFolderErrorFactory {
  path(message: string): Error;
  notFound(folder: string): Error;
  conflict(folder: string, message?: string): Error;
  notInLocation(ids: string[]): Error;
}

/** How a family binds the store. */
export interface ItemFolderStoreConfig<T extends StoredItem> {
  kind: ItemFamilyKind;
  rules: ItemFolderRules;
  /** The item files' extension. */
  ext: '.md' | '.json';
  /** The noun log lines use, singular and plural, and the id key on them. */
  noun: { one: string; many: string; idKey: string };
  /** The file a record lands in, and what it says. */
  fileNameFor(record: T): string;
  serialize(record: T): string;
  /** Parse the folder. */
  scan(mountPointId: string): Promise<ItemFolderScan<T>>;
  /** For the folder tree: which documents are this family's, and which carry their own id. */
  isItemDocument(doc: { relativePath: string; content?: string | null }): boolean;
  hasStableId(content: string | null | undefined): boolean;
  errors: ItemFolderErrorFactory;
  /** Wrap every write (the Inventory marks its writes as already title-linted). */
  wrapWrite?<R>(fn: () => Promise<R>): Promise<R>;
}

/** What a family's `vault-writes.ts` re-exports under its own names. */
export interface ItemFolderStore<T extends StoredItem> {
  /** The family's folder in a character's vault, or Quilltap General for null. Throws for an archived character. */
  resolveMount(characterId: string | null | undefined): Promise<VaultFolderMount | null>;
  /** Every record in the folder, archived included. */
  read(mount: VaultFolderMount): Promise<T[]>;
  /** Re-project the folder from an authoritative list (sweeping only the files the scan owns). */
  project(mount: VaultFolderMount, records: readonly T[], scan?: ItemFolderScan<T>): Promise<void>;
  create(mount: VaultFolderMount, record: T, opts?: { guard?: ItemWriteGuard<T> }): Promise<T>;
  /**
   * Patch several records with one read and one projection; the updated
   * records in patch order. A missing id is skipped, or with `requireAll`
   * refuses the batch before anything is written.
   */
  updateMany(
    mount: VaultFolderMount,
    patches: readonly ItemPatch<T>[],
    opts?: { requireAll?: boolean; guard?: ItemWriteGuard<T> },
  ): Promise<T[]>;
  /**
   * Delete records, applying any `followOn` patches to the survivors in the
   * same projection. Returns the ids actually deleted.
   */
  delete(mount: VaultFolderMount, ids: readonly string[], followOn?: (remaining: T[]) => ItemPatch<T>[]): Promise<string[]>;
  listFolders(mount: VaultFolderMount): Promise<ItemFolder[]>;
  listFolderPaths(mount: VaultFolderMount): Promise<string[]>;
  createFolder(mount: VaultFolderMount, folder: string): Promise<ItemFolder>;
  renameFolder(mount: VaultFolderMount, folder: string, newName: string): Promise<ItemFolder>;
  deleteFolder(
    mount: VaultFolderMount,
    folder: string,
  ): Promise<{ movedItems: number; movedFolders: number; parent: string }>;
}

/**
 * Bind the folder store for a family. Each mutation reads the folder's
 * records, applies the change in memory and re-projects the whole folder
 * through `projectArrayIntoVaultFolder` (recursive, reserved segments
 * excluded, sweeping only the files the scan parsed into records),
 * serialised per folder; each write parses the folder once. The folder
 * operations are the shared `item-folder-ops.ts` ones over this family's tree.
 */
export function createItemFolderStore<T extends StoredItem>(config: ItemFolderStoreConfig<T>): ItemFolderStore<T> {
  const { kind, rules, noun } = config;
  const wrap = <R>(fn: () => Promise<R>): Promise<R> => (config.wrapWrite ? config.wrapWrite(fn) : fn());
  const serialized = <R>(mountPointId: string, fn: () => Promise<R>): Promise<R> =>
    runSerialized(chainKey(rules, mountPointId), () => wrap(fn));

  /** The folder a record is written to: already safe, or normalised (or the root). */
  const safeFolder = (folder: string | null | undefined): string => {
    if (!folder) return '';
    if (isSafeItemFolderPath(rules, folder)) return folder;
    const normalised = normalizeItemFolderPathOrRoot(rules, folder);
    logger.debug('[ItemStore] Write normalised an incoming folder', { kind, folder, normalised, context: kind });
    return normalised;
  };

  const project: ItemFolderStore<T>['project'] = async (mount, records, scanned) => {
    const { duplicatePaths, ownedPaths } = scanned ?? (await config.scan(mount.mountPointId));
    if (duplicatePaths.size > 0) {
      logger.debug('[ItemStore] Projection leaving duplicate-id files alone', {
        kind,
        mountPointId: mount.mountPointId,
        paths: Array.from(duplicatePaths),
        context: kind,
      });
    }
    await projectArrayIntoVaultFolder(
      mount.mountPointId,
      rules.root,
      records,
      (record) => ({ fileName: config.fileNameFor(record), content: config.serialize(record) }),
      mount.characterId ?? mount.mountPointId,
      {
        recursive: { excludeSubfolders: rules.reserved },
        ownsFile: (doc) => ownedPaths.has(doc.relativePath),
        // Claimed so no projected record is written over one.
        preserveFileNames: Array.from(duplicatePaths, (path) => path.slice(path.lastIndexOf('/') + 1)),
        ext: config.ext,
      },
    );
  };

  /**
   * Apply patches in memory: identity and `createdAt` are the record's own,
   * `updatedAt` is now, `remove` drops stored keys.
   */
  const applyPatches = (records: readonly T[], patches: readonly ItemPatch<T>[]) => {
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
      next[idx] = merged as unknown as T;
      updatedIds.push(id);
    }
    return { next, updatedIds, indexById };
  };

  const updateManyUnserialized = async (
    mount: VaultFolderMount,
    patches: readonly ItemPatch<T>[],
    opts: { requireAll?: boolean; guard?: ItemWriteGuard<T> } = {},
    scanned?: ItemFolderScan<T>,
  ): Promise<T[]> => {
    const scan = scanned ?? (await config.scan(mount.mountPointId));
    opts.guard?.(scan.records);
    if (opts.requireAll) {
      const present = new Set(scan.records.map((record) => record.id));
      const missing = patches.map((p) => p.id).filter((id) => !present.has(id));
      if (missing.length > 0) throw config.errors.notInLocation(Array.from(new Set(missing)));
    }
    const { next, updatedIds, indexById } = applyPatches(scan.records, patches);
    if (updatedIds.length === 0) return [];
    await project(mount, next, scan);
    logger.debug(`[ItemStore] ${noun.many} updated in folder`, {
      kind,
      scope: mount.scope,
      mountPointId: mount.mountPointId,
      [`${noun.idKey}s`]: updatedIds,
      count: updatedIds.length,
      op: 'update',
      context: kind,
    });
    return updatedIds.map((id) => next[indexById.get(id) as number]);
  };

  // The scan behind each record list the folder operations read, keyed by
  // that exact array: a folder operation reads, then reprojects or refiles
  // from what it read on the same chain, so the write reuses the scan instead
  // of parsing the folder again. Anything else reads afresh.
  const treeScans = new WeakMap<readonly T[], ItemFolderScan<T>>();
  const tree: ItemFolderTree<T> = {
    rules,
    ext: config.ext,
    context: kind,
    isItemDocument: config.isItemDocument,
    hasStableId: config.hasStableId,
    read: async (mount) => {
      const scan = await config.scan(mount.mountPointId);
      treeScans.set(scan.records, scan);
      return scan.records;
    },
    reproject: (mount, records) => project(mount, records, treeScans.get(records)),
    refile: (mount, patches, current) =>
      updateManyUnserialized(
        mount,
        patches.map(({ id, folder }) => ({ id, patch: { folder } as Partial<T> })),
        {},
        treeScans.get(current),
      ),
    errors: {
      path: (message) => config.errors.path(message),
      notFound: (folder) => config.errors.notFound(folder),
      conflict: (folder, message) => config.errors.conflict(folder, message),
    },
  };

  return {
    resolveMount: (characterId) => resolveVaultFolderMount(characterId),
    read: async (mount) => (await config.scan(mount.mountPointId)).records,
    project,
    create: (mount, record, opts = {}) =>
      serialized(mount.mountPointId, async () => {
        const scan = await config.scan(mount.mountPointId);
        opts.guard?.(scan.records);
        const stored = { ...record, folder: safeFolder(record.folder) } as T;
        await project(mount, [...scan.records, stored], scan);
        logger.debug(`[ItemStore] ${noun.one} created in folder`, {
          kind,
          scope: mount.scope,
          mountPointId: mount.mountPointId,
          [noun.idKey]: stored.id,
          folder: stored.folder,
          op: 'create',
          context: kind,
        });
        return stored;
      }),
    updateMany: (mount, patches, opts = {}) =>
      patches.length === 0
        ? Promise.resolve([])
        : serialized(mount.mountPointId, () => updateManyUnserialized(mount, patches, opts)),
    delete: (mount, ids, followOn = () => []) =>
      serialized(mount.mountPointId, async () => {
        const doomed = new Set(ids);
        const scan = await config.scan(mount.mountPointId);
        const deleted = scan.records.filter((record) => doomed.has(record.id)).map((record) => record.id);
        if (deleted.length === 0) return [];
        const survivors = scan.records.filter((record) => !doomed.has(record.id));
        const patches = followOn(survivors);
        const remaining = patches.length > 0 ? applyPatches(survivors, patches).next : survivors;
        await project(mount, remaining, scan);
        logger.debug(`[ItemStore] ${noun.many} deleted from folder`, {
          kind,
          scope: mount.scope,
          mountPointId: mount.mountPointId,
          [`${noun.idKey}s`]: deleted,
          followOnPatches: patches.length,
          op: 'delete',
          context: kind,
        });
        return deleted;
      }),
    listFolders: (mount) => listFoldersIn(tree, mount),
    listFolderPaths: (mount) => listFolderPathsIn(tree, mount),
    createFolder: (mount, folder) => wrap(() => createFolderIn(tree, mount, folder)),
    renameFolder: (mount, folder, newName) => wrap(() => renameFolderIn(tree, mount, folder, newName)),
    deleteFolder: (mount, folder) => wrap(() => deleteFolderIn(tree, mount, folder)),
  };
}

// ============================================================================
// The location write wrapper
// ============================================================================

/** Identity and timestamps are the writer's, never a patch's. */
export function cleanPatch<T extends Partial<StoredItem>>(patch: T): T {
  const rest = { ...patch };
  delete rest.id;
  delete rest.createdAt;
  delete rest.updatedAt;
  return rest;
}

/** What a location builds its writes from. */
export interface LocationWriter<M extends VaultFolderMount> {
  /** The mount to write to now: a character's is re-resolved, so the tombstone check sees them as they are. */
  writableMount(): Promise<M>;
  /**
   * Run a write against the current writable mount, then publish the
   * family's realtime topic — only when something landed (`landed`, default
   * always; a batch or delete that matched nothing changed nothing).
   */
  write<R>(fn: (target: M) => Promise<R>, landed?: (result: R) => boolean): Promise<R>;
  /** The `landed` test for a write that returns what it changed. */
  nonEmpty(result: readonly unknown[]): boolean;
}

/** The write half every family's location shares. */
export function locationWriter<M extends VaultFolderMount>(
  kind: ItemFamilyKind,
  mount: M,
  resolveMount: (characterId: string | null) => Promise<M | null>,
): LocationWriter<M> {
  const writableMount = async (): Promise<M> => {
    if (mount.scope !== 'character') return mount;
    const current = await resolveMount(mount.characterId);
    if (!current) throw new Error(`Character ${mount.characterId} has no linked vault`);
    return current;
  };
  return {
    writableMount,
    async write(fn, landed = () => true) {
      const result = await fn(await writableMount());
      if (landed(result)) publishRealtime(kind);
      return result;
    },
    nonEmpty: (result) => result.length > 0,
  };
}
