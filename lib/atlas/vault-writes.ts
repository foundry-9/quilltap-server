/**
 * Atlas writes — the one place an Atlas entry reaches disk.
 *
 * Every tier's entries are `.md` files under an `Atlas/` folder in some mount
 * (a character's vault, a group store, a project store, Quilltap General).
 * Each mutation reads the folder's records, applies the change in memory and
 * re-projects the whole folder through `projectArrayIntoVaultFolder`
 * (recursive, `images/` excluded, sweeping only the files the scan parsed into
 * entries), serialised per folder. The folder operations are the shared
 * `item-folder-ops.ts` ones.
 *
 * Callers reach this through `resolveAtlasLocation` (`lib/atlas/location.ts`).
 * A grep-test holds that nothing else writes a file under `Atlas/`.
 *
 * Server-only.
 *
 * @module lib/atlas/vault-writes
 */

import { logger } from '@/lib/logger';
import { serializeFrontmatter } from '@/lib/doc-edit/markdown-parser';
import {
  ATLAS_FOLDER,
  ATLAS_FOLDER_RULES,
  ATLAS_RESERVED_FOLDER_SEGMENTS,
  AtlasEntryNotInLocationError,
  AtlasFolderConflictError,
  AtlasFolderNotFoundError,
  AtlasFolderPathError,
  isSafeAtlasFolderPath,
  normalizeAtlasFolderPathOrRoot,
  type AtlasFolder,
} from '@/lib/atlas/folders';
import { ATLAS_FRONTMATTER_KEYS, type AtlasRecord } from '@/lib/schemas/atlas.types';
import {
  atlasFileNameFor,
  hasStableAtlasEntryId,
  isAtlasEntryDocument,
  readAtlasRecords,
  scanAtlasFolder,
  type AtlasFolderScan,
} from '@/lib/atlas/vault-readers';
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
} from '@/lib/mount-index/item-folder-ops';
import { projectArrayIntoVaultFolder } from '@/lib/mount-index/vault-projection';

/** An Atlas tier's folder on disk. */
export type AtlasMount = VaultFolderMount;

function runSerialized<T>(mountPointId: string, fn: () => Promise<T>): Promise<T> {
  return runSerializedOnKey(chainKey(ATLAS_FOLDER_RULES, mountPointId), fn);
}

/**
 * Resolve the Atlas folder's mount for a character id, or Quilltap General
 * for `null`. Throws `CharacterArchivedError` for an archived character.
 */
export function resolveAtlasMount(characterId: string | null | undefined): Promise<AtlasMount | null> {
  return resolveVaultFolderMount(characterId);
}

/** Every record in the folder, archived included. */
export function readMountAtlas(mount: AtlasMount): Promise<AtlasRecord[]> {
  return readAtlasRecords(mount.mountPointId);
}

/**
 * The file a record serialises to: frontmatter carrying
 * {@link ATLAS_FRONTMATTER_KEYS} in schema order, then a blank line and the
 * knowledge verbatim as the body.
 */
export function serializeAtlasRecord(record: AtlasRecord): string {
  const front: Record<string, unknown> = {};
  const source = record as unknown as Record<string, unknown>;
  for (const key of ATLAS_FRONTMATTER_KEYS) {
    if (source[key] !== undefined) front[key] = source[key];
  }
  const knowledge = record.knowledge?.replace(/\s+$/, '') ?? '';
  return `${serializeFrontmatter(front)}${knowledge ? `\n${knowledge}\n` : ''}`;
}

function safeFolder(folder: string | null | undefined): string {
  if (!folder) return '';
  if (isSafeAtlasFolderPath(folder)) return folder;
  const normalised = normalizeAtlasFolderPathOrRoot(folder);
  logger.debug('Atlas write normalised an incoming folder', { folder, normalised, context: 'atlas' });
  return normalised;
}

/**
 * Re-project the folder from an authoritative record list. Only the files
 * the scan turned into records are swept; a note or a duplicate-id file is
 * left where it is.
 */
export async function projectMountAtlas(
  mount: AtlasMount,
  records: readonly AtlasRecord[],
  scan?: AtlasFolderScan,
): Promise<void> {
  const { duplicatePaths, ownedPaths } = scan ?? (await scanAtlasFolder(mount.mountPointId));
  if (duplicatePaths.size > 0) {
    logger.debug('Atlas projection leaving duplicate-id files alone', {
      mountPointId: mount.mountPointId,
      paths: Array.from(duplicatePaths),
      context: 'atlas',
    });
  }
  await projectArrayIntoVaultFolder(
    mount.mountPointId,
    ATLAS_FOLDER,
    records,
    (record) => ({ fileName: atlasFileNameFor(record), content: serializeAtlasRecord(record) }),
    mount.characterId ?? mount.mountPointId,
    {
      recursive: { excludeSubfolders: ATLAS_RESERVED_FOLDER_SEGMENTS },
      ownsFile: (doc) => ownedPaths.has(doc.relativePath),
      preserveFileNames: Array.from(duplicatePaths, (path) => path.slice(path.lastIndexOf('/') + 1)),
      ext: '.md',
    },
  );
}

/**
 * A check run inside the folder's write chain against the records as they are
 * now, before anything is written; it throws to refuse. What makes a
 * read-then-write rule (a free name) hold under concurrent writers.
 */
export type AtlasWriteGuard = (records: readonly AtlasRecord[]) => void;

/** Create a record in the folder. */
export async function createAtlasInMount(
  mount: AtlasMount,
  record: AtlasRecord,
  opts: { guard?: AtlasWriteGuard } = {},
): Promise<AtlasRecord> {
  return runSerialized(mount.mountPointId, async () => {
    const scan = await scanAtlasFolder(mount.mountPointId);
    opts.guard?.(scan.records);
    const stored: AtlasRecord = { ...record, folder: safeFolder(record.folder) };
    await projectMountAtlas(mount, [...scan.records, stored], scan);
    logger.debug('Atlas entry created in folder', {
      scope: mount.scope,
      mountPointId: mount.mountPointId,
      entryId: stored.id,
      folder: stored.folder,
      op: 'create',
      context: 'atlas',
    });
    return stored;
  });
}

/** One record's change in an {@link updateAtlasManyInMount} batch. */
export interface AtlasRecordPatch {
  id: string;
  patch: Partial<AtlasRecord>;
}

function applyPatches(
  records: readonly AtlasRecord[],
  patches: readonly AtlasRecordPatch[],
): { next: AtlasRecord[]; updatedIds: string[]; indexById: Map<string, number> } {
  const indexById = new Map(records.map((record, idx) => [record.id, idx]));
  const next = records.slice();
  const now = new Date().toISOString();
  const updatedIds: string[] = [];
  for (const { id, patch } of patches) {
    const idx = indexById.get(id);
    if (idx === undefined) continue;
    const before = next[idx];
    next[idx] = {
      ...before,
      ...patch,
      ...(patch.folder !== undefined && { folder: safeFolder(patch.folder) }),
      id: before.id,
      createdAt: before.createdAt,
      updatedAt: now,
    };
    updatedIds.push(id);
  }
  return { next, updatedIds, indexById };
}

/**
 * Patch several records with one read and one projection; the updated records
 * in patch order. A missing id is skipped, or with `requireAll` refuses the
 * batch before anything is written.
 */
export async function updateAtlasManyInMount(
  mount: AtlasMount,
  patches: readonly AtlasRecordPatch[],
  opts: { requireAll?: boolean; guard?: AtlasWriteGuard } = {},
): Promise<AtlasRecord[]> {
  if (patches.length === 0) return [];
  return runSerialized(mount.mountPointId, () => updateManyUnserialized(mount, patches, opts));
}

async function updateManyUnserialized(
  mount: AtlasMount,
  patches: readonly AtlasRecordPatch[],
  opts: { requireAll?: boolean; guard?: AtlasWriteGuard } = {},
  scanned?: AtlasFolderScan,
): Promise<AtlasRecord[]> {
  const scan = scanned ?? (await scanAtlasFolder(mount.mountPointId));
  opts.guard?.(scan.records);
  if (opts.requireAll) {
    const present = new Set(scan.records.map((record) => record.id));
    const missing = patches.map((p) => p.id).filter((id) => !present.has(id));
    if (missing.length > 0) throw new AtlasEntryNotInLocationError(Array.from(new Set(missing)));
  }
  const { next, updatedIds, indexById } = applyPatches(scan.records, patches);
  if (updatedIds.length === 0) return [];
  await projectMountAtlas(mount, next, scan);
  logger.debug('Atlas entries updated in folder', {
    scope: mount.scope,
    mountPointId: mount.mountPointId,
    entryIds: updatedIds,
    count: updatedIds.length,
    op: 'update',
    context: 'atlas',
  });
  return updatedIds.map((id) => next[indexById.get(id) as number]);
}

/** Delete records from the folder. Returns the ids actually deleted. */
export async function deleteAtlasInMount(mount: AtlasMount, ids: readonly string[]): Promise<string[]> {
  return runSerialized(mount.mountPointId, async () => {
    const doomed = new Set(ids);
    const scan = await scanAtlasFolder(mount.mountPointId);
    const deleted = scan.records.filter((record) => doomed.has(record.id)).map((record) => record.id);
    if (deleted.length === 0) return [];
    await projectMountAtlas(mount, scan.records.filter((record) => !doomed.has(record.id)), scan);
    logger.debug('Atlas entries deleted from folder', {
      scope: mount.scope,
      mountPointId: mount.mountPointId,
      entryIds: deleted,
      op: 'delete',
      context: 'atlas',
    });
    return deleted;
  });
}

// ============================================================================
// Folders — the shared folder operations over the Atlas's tree
// ============================================================================

const treeScans = new WeakMap<readonly AtlasRecord[], AtlasFolderScan>();

async function readForTree(mount: AtlasMount): Promise<AtlasRecord[]> {
  const scan = await scanAtlasFolder(mount.mountPointId);
  treeScans.set(scan.records, scan);
  return scan.records;
}

const ATLAS_TREE: ItemFolderTree<AtlasRecord> = {
  rules: ATLAS_FOLDER_RULES,
  ext: '.md',
  context: 'atlas',
  isItemDocument: isAtlasEntryDocument,
  hasStableId: hasStableAtlasEntryId,
  read: readForTree,
  reproject: (mount, records) => projectMountAtlas(mount, records, treeScans.get(records)),
  refile: (mount, patches, current) =>
    updateManyUnserialized(
      mount,
      patches.map(({ id, folder }) => ({ id, patch: { folder } })),
      {},
      treeScans.get(current),
    ),
  errors: {
    path: (message) => new AtlasFolderPathError(message),
    notFound: (folder) => new AtlasFolderNotFoundError(folder),
    conflict: (folder, message) => new AtlasFolderConflictError(folder, message),
  },
};

/** Every folder under the tier's `Atlas/`, with direct entry counts. */
export function listAtlasFoldersInMount(mount: AtlasMount): Promise<AtlasFolder[]> {
  return listFoldersIn(ATLAS_TREE, mount);
}

/** Every folder path under the tier's `Atlas/`. */
export function listAtlasFolderPathsInMount(mount: AtlasMount): Promise<string[]> {
  return listFolderPathsIn(ATLAS_TREE, mount);
}

/** Create a folder (normalised path); an existing one in any casing is answered. */
export function createAtlasFolderInMount(mount: AtlasMount, folder: string): Promise<AtlasFolder> {
  return createFolderIn(ATLAS_TREE, mount, folder);
}

/** Rename a folder in place. */
export function renameAtlasFolderInMount(mount: AtlasMount, folder: string, newName: string): Promise<AtlasFolder> {
  return renameFolderIn(ATLAS_TREE, mount, folder, newName);
}

/** Delete a folder, sending its entries and subfolders up to its parent. */
export function deleteAtlasFolderInMount(
  mount: AtlasMount,
  folder: string,
): Promise<{ movedItems: number; movedFolders: number; parent: string }> {
  return deleteFolderIn(ATLAS_TREE, mount, folder);
}
