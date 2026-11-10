/**
 * Atlas folders — the rules for the operator's filing inside a tier's
 * `Atlas/` folder. The Inventory's rules exactly: the path is the truth, `''`
 * is the root, at most eight segments, `images` reserved at any depth,
 * case-insensitively unique siblings.
 *
 * Every helper is a delegate over {@link ATLAS_FOLDER_RULES}; the rules live
 * once in `lib/mount-index/item-folders.ts`.
 *
 * Client-safe: pure, no server imports.
 *
 * @module lib/atlas/folders
 */

import {
  folderOfItemPath,
  ItemFolderConflictError,
  ItemFolderNotFoundError,
  ItemFolderPathError,
  ItemNotInLocationError,
  isItemDocumentPath,
  isSafeItemFolderPath,
  isValidItemFolderPath,
  normalizeItemFolderPathOrRoot,
  resolveItemFolder,
  type ItemFolder,
  type ItemFolderRules,
} from '@/lib/mount-index/item-folders';

export {
  folderCrumb,
  folderName,
  folderSegments,
  isSameFolder,
  isUnderFolder,
  joinFolder,
  parentFolder,
  rebaseFolder,
} from '@/lib/mount-index/item-folders';

/** The folder every tier's entries live under. */
export const ATLAS_FOLDER = 'Atlas';

/** The deepest an Atlas folder may nest. */
export const ATLAS_FOLDER_MAX_DEPTH = 8;

/** `Atlas/images/<entryId>/` holds entry pictures. */
export const ATLAS_RESERVED_FOLDER_SEGMENTS: readonly string[] = ['images'];

/** Where entry pictures live, under a tier's mount. */
export const ATLAS_IMAGES_FOLDER = 'Atlas/images';

/** The Atlas's filing rules. */
export const ATLAS_FOLDER_RULES: ItemFolderRules = {
  root: ATLAS_FOLDER,
  reserved: ATLAS_RESERVED_FOLDER_SEGMENTS,
  maxDepth: ATLAS_FOLDER_MAX_DEPTH,
  noun: 'atlas',
};

/** A folder path that breaks the rules (a 400 at the route). */
export class AtlasFolderPathError extends ItemFolderPathError {
  constructor(message: string) {
    super(message);
    this.name = 'AtlasFolderPathError';
  }
}

/** The folder named doesn't exist (a 404 at the route). */
export class AtlasFolderNotFoundError extends ItemFolderNotFoundError {
  constructor(folder: string) {
    super(folder, 'atlas');
    this.name = 'AtlasFolderNotFoundError';
  }
}

/** The folder change collides with what's already there (a 409 at the route). */
export class AtlasFolderConflictError extends ItemFolderConflictError {
  constructor(folder: string, message?: string) {
    super(folder, message, 'atlas');
    this.name = 'AtlasFolderConflictError';
  }
}

/** A filing request named entries filed in another tier (a 400 at the route). */
export class AtlasEntryNotInLocationError extends ItemNotInLocationError {
  constructor(entryIds: string[]) {
    super(entryIds, 'atlas');
    this.name = 'AtlasEntryNotInLocationError';
  }
}

/** A folder as the browser and the folder routes see it. */
export type AtlasFolder = ItemFolder;

const pathError = (message: string) => new AtlasFolderPathError(message);

/** A folder an existing entry carries, in normal form or the root. */
export function normalizeAtlasFolderPathOrRoot(input: string | null | undefined): string {
  return normalizeItemFolderPathOrRoot(ATLAS_FOLDER_RULES, input);
}

/** True when `path` is structurally safe to write under `Atlas/`. */
export function isSafeAtlasFolderPath(path: string): boolean {
  return isSafeItemFolderPath(ATLAS_FOLDER_RULES, path);
}

/** Resolve an operator's requested folder against the folders a tier already has. */
export function resolveAtlasFolder(existing: readonly string[], requested: string | null | undefined): string {
  return resolveItemFolder(ATLAS_FOLDER_RULES, existing, requested, pathError);
}

/** True when `path` is already in normal form. */
export function isValidAtlasFolderPath(path: string): boolean {
  return isValidItemFolderPath(ATLAS_FOLDER_RULES, path);
}

/** The folder an `Atlas/` document lives in: `Atlas/A/B/x.md` → `A/B`. */
export function folderOfAtlasPath(relativePath: string): string {
  return folderOfItemPath(ATLAS_FOLDER_RULES, relativePath);
}

/**
 * True for a document path that can hold an Atlas entry: a `.md` file
 * anywhere under `Atlas/` except under `Atlas/images/`. Whether its
 * frontmatter makes it an entry is `isAtlasEntryDocument`'s question.
 */
export function isAtlasEntryDocumentPath(relativePath: string): boolean {
  return isItemDocumentPath(ATLAS_FOLDER_RULES, relativePath, '.md');
}
