/**
 * Atlas folders — the rules for the operator's filing inside a tier's
 * `Atlas/` folder. The Inventory's rules exactly: the path is the truth, `''`
 * is the root, at most eight segments, `images` reserved at any depth,
 * case-insensitively unique siblings.
 *
 * A binding of the shared rules (`lib/mount-index/item-folders.ts`:
 * `defineItemFolderErrors`, `defineItemFolderFamily`); the rules live once.
 *
 * Client-safe: pure, no server imports.
 *
 * @module lib/atlas/folders
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

const errors = defineItemFolderErrors('Atlas', 'atlas', 'Entry');

/** A folder path that breaks the rules (a 400 at the route). */
export const AtlasFolderPathError = errors.FolderPathError;
export type AtlasFolderPathError = InstanceType<typeof AtlasFolderPathError>;

/** The folder named doesn't exist (a 404 at the route). */
export const AtlasFolderNotFoundError = errors.FolderNotFoundError;
export type AtlasFolderNotFoundError = InstanceType<typeof AtlasFolderNotFoundError>;

/** The folder change collides with what's already there (a 409 at the route). */
export const AtlasFolderConflictError = errors.FolderConflictError;
export type AtlasFolderConflictError = InstanceType<typeof AtlasFolderConflictError>;

/** A filing request named entries filed in another tier (a 400 at the route). */
export const AtlasEntryNotInLocationError = errors.NotInLocationError;
export type AtlasEntryNotInLocationError = InstanceType<typeof AtlasEntryNotInLocationError>;

/** A folder as the browser and the folder routes see it. */
export type AtlasFolder = ItemFolder;

const family = defineItemFolderFamily(ATLAS_FOLDER_RULES, '.md', errors);

/** A folder an existing entry carries, in normal form or the root. */
export const normalizeAtlasFolderPathOrRoot = family.normalizeOrRoot;

/** True when `path` is structurally safe to write under `Atlas/`. */
export const isSafeAtlasFolderPath = family.isSafe;

/** Resolve an operator's requested folder against the folders a tier already has. */
export const resolveAtlasFolder = family.resolve;

/** True when `path` is already in normal form. */
export const isValidAtlasFolderPath = family.isValid;

/** The folder an `Atlas/` document lives in: `Atlas/A/B/x.md` → `A/B`. */
export const folderOfAtlasPath = family.folderOf;

/**
 * True for a document path that can hold an Atlas entry: a `.md` file
 * anywhere under `Atlas/` except under `Atlas/images/`. Whether its
 * frontmatter makes it an entry is `isAtlasEntryDocument`'s question.
 */
export const isAtlasEntryDocumentPath = family.isDocumentPath;
