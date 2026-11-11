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
 * A binding of the rules shared with the Inventory and the Atlas
 * (`lib/mount-index/item-folders.ts`: `defineItemFolderErrors`,
 * `defineItemFolderFamily`); the rules live once.
 *
 * Client-safe: pure, no server imports.
 *
 * @module lib/wardrobe/folders
 */

import {
  defineItemFolderErrors,
  defineItemFolderFamily,
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

const errors = defineItemFolderErrors('Wardrobe', 'wardrobe');

/** A folder path that breaks the rules (a 400 at the route). */
export const WardrobeFolderPathError = errors.FolderPathError;
export type WardrobeFolderPathError = InstanceType<typeof WardrobeFolderPathError>;

/** The folder named doesn't exist (a 404 at the route). */
export const WardrobeFolderNotFoundError = errors.FolderNotFoundError;
export type WardrobeFolderNotFoundError = InstanceType<typeof WardrobeFolderNotFoundError>;

/** The folder change collides with what's already there (a 409 at the route). */
export const WardrobeFolderConflictError = errors.FolderConflictError;
export type WardrobeFolderConflictError = InstanceType<typeof WardrobeFolderConflictError>;

/** A filing request named items filed in another tier (a 400 at the route). */
export const WardrobeItemNotInLocationError = errors.NotInLocationError;
export type WardrobeItemNotInLocationError = InstanceType<typeof WardrobeItemNotInLocationError>;

/** A folder as the browser and the folder routes see it. */
export type WardrobeFolder = ItemFolder;

const family = defineItemFolderFamily(WARDROBE_FOLDER_RULES, '.md', errors);

/** Normalise an operator-typed folder path (see `normalizeItemFolderPath`). */
export const normalizeWardrobeFolderPath = family.normalizePath;

/** A folder an existing item carries, in normal form or the root. */
export const normalizeWardrobeFolderPathOrRoot = family.normalizeOrRoot;

/** True when `path` is structurally safe to write under `Wardrobe/`. */
export const isSafeWardrobeFolderPath = family.isSafe;

/** Resolve an operator's requested folder against the folders a wardrobe already has. */
export const resolveWardrobeFolder = family.resolve;

/** True when `path` is already in normal form. */
export const isValidWardrobeFolderPath = family.isValid;

/** The folder a `Wardrobe/` document lives in: `Wardrobe/A/B/x.md` → `A/B`. */
export const folderOfWardrobePath = family.folderOf;
