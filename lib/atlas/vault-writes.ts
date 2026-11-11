/**
 * Atlas writes — the one place an Atlas entry reaches disk.
 *
 * Every tier's entries are `.md` files under an `Atlas/` folder in some mount
 * (a character's vault, a group store, a project store, Quilltap General).
 * A binding of the item-store kernel (`createItemFolderStore`,
 * `lib/mount-index/item-store.ts`) with the Atlas's serialiser — frontmatter
 * then the knowledge as the body — and its scan: each mutation reads the
 * folder, applies the change in memory and re-projects it, serialised per
 * folder. The folder operations are the shared `item-folder-ops.ts` ones.
 *
 * Callers reach this through `resolveAtlasLocation` (`lib/atlas/location.ts`).
 * A grep-test holds that nothing else writes a file under `Atlas/`.
 *
 * Server-only.
 *
 * @module lib/atlas/vault-writes
 */

import { serializeFrontmatter } from '@/lib/doc-edit/markdown-parser';
import {
  ATLAS_FOLDER_RULES,
  AtlasEntryNotInLocationError,
  AtlasFolderConflictError,
  AtlasFolderNotFoundError,
  AtlasFolderPathError,
  type AtlasFolder,
} from '@/lib/atlas/folders';
import { ATLAS_FRONTMATTER_KEYS, type AtlasRecord } from '@/lib/schemas/atlas.types';
import {
  atlasFileNameFor,
  hasStableAtlasEntryId,
  isAtlasEntryDocument,
  scanAtlasFolder,
  type AtlasFolderScan,
} from '@/lib/atlas/vault-readers';
import type { VaultFolderMount } from '@/lib/mount-index/item-folder-ops';
import { createItemFolderStore, type ItemPatch, type ItemWriteGuard } from '@/lib/mount-index/item-store';

/** An Atlas tier's folder on disk. */
export type AtlasMount = VaultFolderMount;

/** One record's change in an {@link updateAtlasManyInMount} batch. */
export type AtlasRecordPatch = ItemPatch<AtlasRecord>;

/** A check run inside the folder's write chain against the current records; it throws to refuse. */
export type AtlasWriteGuard = ItemWriteGuard<AtlasRecord>;

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

const store = createItemFolderStore<AtlasRecord>({
  kind: 'atlas',
  rules: ATLAS_FOLDER_RULES,
  ext: '.md',
  noun: { one: 'Atlas entry', many: 'Atlas entries', idKey: 'entryId' },
  fileNameFor: atlasFileNameFor,
  serialize: serializeAtlasRecord,
  scan: scanAtlasFolder,
  isItemDocument: isAtlasEntryDocument,
  hasStableId: hasStableAtlasEntryId,
  errors: {
    path: (message) => new AtlasFolderPathError(message),
    notFound: (folder) => new AtlasFolderNotFoundError(folder),
    conflict: (folder, message) => new AtlasFolderConflictError(folder, message),
    notInLocation: (ids) => new AtlasEntryNotInLocationError(ids),
  },
});

/**
 * Resolve the Atlas folder's mount for a character id, or Quilltap General
 * for `null`. Throws `CharacterArchivedError` for an archived character.
 */
export const resolveAtlasMount: (characterId: string | null | undefined) => Promise<AtlasMount | null> = store.resolveMount;

/** Every record in the folder, archived included. */
export const readMountAtlas: (mount: AtlasMount) => Promise<AtlasRecord[]> = store.read;

/** Re-project the folder from an authoritative record list (sweeping only the files the scan owns). */
export const projectMountAtlas: (mount: AtlasMount, records: readonly AtlasRecord[], scan?: AtlasFolderScan) => Promise<void> =
  store.project;

/** Create a record in the folder; `guard` runs inside the write chain first. */
export const createAtlasInMount = store.create;

/**
 * Patch several records with one read and one projection; the updated records
 * in patch order. A missing id is skipped, or with `requireAll` refuses the
 * batch before anything is written.
 */
export const updateAtlasManyInMount = store.updateMany;

/** Delete records from the folder. Returns the ids actually deleted. */
export function deleteAtlasInMount(mount: AtlasMount, ids: readonly string[]): Promise<string[]> {
  return store.delete(mount, ids);
}

/** Every folder under the tier's `Atlas/`, with direct entry counts. */
export const listAtlasFoldersInMount: (mount: AtlasMount) => Promise<AtlasFolder[]> = store.listFolders;

/** Every folder path under the tier's `Atlas/`. */
export const listAtlasFolderPathsInMount = store.listFolderPaths;

/** Create a folder (normalised path); an existing one in any casing is answered. */
export const createAtlasFolderInMount = store.createFolder;

/** Rename a folder in place. */
export const renameAtlasFolderInMount = store.renameFolder;

/** Delete a folder, sending its entries and subfolders up to its parent. */
export const deleteAtlasFolderInMount = store.deleteFolder;
