/**
 * Wardrobe folders — the rules for the operator's filing inside a tier's
 * `Wardrobe/` folder.
 *
 * A folder is a path relative to `Wardrobe/`: `''` for the root, otherwise
 * `Seg/Seg/Seg` with no leading or trailing slash. It is the file's path and
 * nothing else — derived from `relativePath` on read, written back as the
 * path on projection, never stored in frontmatter. Folders organise what the
 * operator sees; they carry no meaning for what a character can wear.
 *
 * The rules themselves are shared with the Inventory and live in
 * `lib/mount-index/item-folders.ts`; everything here is a delegate over
 * {@link WARDROBE_FOLDER_RULES}.
 *
 * Client-safe: pure, no server imports.
 *
 * @module lib/wardrobe/folders
 */

import {
  folderOfItemPath,
  ItemFolderConflictError,
  ItemFolderNotFoundError,
  ItemFolderPathError,
  ItemNotInLocationError,
  isSafeItemFolderPath,
  isValidItemFolderPath,
  itemFolderStorePath,
  normalizeItemFolderName,
  normalizeItemFolderPath,
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

/** The deepest a wardrobe folder may nest. */
export const WARDROBE_FOLDER_MAX_DEPTH = 8;

/**
 * Segments a wardrobe folder may never use, compared case-insensitively.
 * `Wardrobe/images/<itemId>/` holds item pictures.
 */
export const WARDROBE_RESERVED_FOLDER_SEGMENTS: readonly string[] = ['images'];

/** The wardrobe's filing rules. */
export const WARDROBE_FOLDER_RULES: ItemFolderRules = {
  root: 'Wardrobe',
  reserved: WARDROBE_RESERVED_FOLDER_SEGMENTS,
  maxDepth: WARDROBE_FOLDER_MAX_DEPTH,
  noun: 'wardrobe',
};

/** A folder path that breaks the rules (a 400 at the route). */
export class WardrobeFolderPathError extends ItemFolderPathError {
  constructor(message: string) {
    super(message);
    this.name = 'WardrobeFolderPathError';
  }
}

/** The folder named doesn't exist (a 404 at the route). */
export class WardrobeFolderNotFoundError extends ItemFolderNotFoundError {
  constructor(folder: string) {
    super(folder, 'wardrobe');
    this.name = 'WardrobeFolderNotFoundError';
  }
}

/**
 * The folder change collides with what's already there — a sibling holding
 * the name, or a folder holding files that aren't items (a 409 at the route).
 */
export class WardrobeFolderConflictError extends ItemFolderConflictError {
  constructor(folder: string, message?: string) {
    super(folder, message, 'wardrobe');
    this.name = 'WardrobeFolderConflictError';
  }
}

/**
 * A filing request named items that aren't filed in this wardrobe — a
 * borrowed item seen from a character's merged view (a 400 at the route).
 */
export class WardrobeItemNotInLocationError extends ItemNotInLocationError {
  constructor(itemIds: string[]) {
    super(itemIds, 'wardrobe');
    this.name = 'WardrobeItemNotInLocationError';
  }
}

/** A folder as the browser and the folder routes see it. */
export type WardrobeFolder = ItemFolder;

const pathError = (message: string) => new WardrobeFolderPathError(message);

/** Normalise an operator-typed folder path (see `normalizeItemFolderPath`). */
export function normalizeWardrobeFolderPath(input: string | null | undefined): string {
  return normalizeItemFolderPath(WARDROBE_FOLDER_RULES, input, pathError);
}

/** A folder an existing item carries, in normal form or the root. */
export function normalizeWardrobeFolderPathOrRoot(input: string | null | undefined): string {
  return normalizeItemFolderPathOrRoot(WARDROBE_FOLDER_RULES, input);
}

/** Normalise a folder *name* — one segment, as a rename takes it. */
export function normalizeWardrobeFolderName(input: string | null | undefined): string {
  return normalizeItemFolderName(WARDROBE_FOLDER_RULES, input, pathError);
}

/** True when `path` is structurally safe to write under `Wardrobe/`. */
export function isSafeWardrobeFolderPath(path: string): boolean {
  return isSafeItemFolderPath(WARDROBE_FOLDER_RULES, path);
}

/** Resolve an operator's requested folder against the folders a wardrobe already has. */
export function resolveWardrobeFolder(existing: readonly string[], requested: string | null | undefined): string {
  return resolveItemFolder(WARDROBE_FOLDER_RULES, existing, requested, pathError);
}

/** True when `path` is already in normal form. */
export function isValidWardrobeFolderPath(path: string): boolean {
  return isValidItemFolderPath(WARDROBE_FOLDER_RULES, path);
}

/** The folder a `Wardrobe/` document lives in: `Wardrobe/A/B/x.md` → `A/B`. */
export function folderOfWardrobePath(relativePath: string): string {
  return folderOfItemPath(WARDROBE_FOLDER_RULES, relativePath);
}

/** The store path of a wardrobe folder: `''` → `Wardrobe`, `A/B` → `Wardrobe/A/B`. */
export function wardrobeFolderStorePath(folder: string): string {
  return itemFolderStorePath(WARDROBE_FOLDER_RULES, folder);
}
