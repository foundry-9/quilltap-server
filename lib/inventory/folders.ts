/**
 * Inventory folders — the rules for the operator's filing inside a tier's
 * `Inventory/` folder. Exactly the wardrobe's rules (`wardrobe-folders.md`
 * §2): the path is the truth, `''` is the root, at most eight segments,
 * `images` reserved at any depth, case-insensitively unique siblings.
 *
 * A binding of the shared rules (`lib/mount-index/item-folders.ts`:
 * `defineItemFolderErrors`, `defineItemFolderFamily`); the rules live once.
 *
 * Client-safe: pure, no server imports.
 *
 * @module lib/inventory/folders
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

/** The folder every tier's objects live under. */
export const INVENTORY_FOLDER = 'Inventory';

/** The deepest an Inventory folder may nest. */
export const INVENTORY_FOLDER_MAX_DEPTH = 8;

/** `Inventory/images/<itemId>/` holds object pictures. */
export const INVENTORY_RESERVED_FOLDER_SEGMENTS: readonly string[] = ['images'];

/** The Inventory's filing rules. */
export const INVENTORY_FOLDER_RULES: ItemFolderRules = {
  root: INVENTORY_FOLDER,
  reserved: INVENTORY_RESERVED_FOLDER_SEGMENTS,
  maxDepth: INVENTORY_FOLDER_MAX_DEPTH,
  noun: 'inventory',
};

const errors = defineItemFolderErrors('Inventory', 'inventory');

/** A folder path that breaks the rules (a 400 at the route). */
export const InventoryFolderPathError = errors.FolderPathError;
export type InventoryFolderPathError = InstanceType<typeof InventoryFolderPathError>;

/** The folder named doesn't exist (a 404 at the route). */
export const InventoryFolderNotFoundError = errors.FolderNotFoundError;
export type InventoryFolderNotFoundError = InstanceType<typeof InventoryFolderNotFoundError>;

/** The folder change collides with what's already there (a 409 at the route). */
export const InventoryFolderConflictError = errors.FolderConflictError;
export type InventoryFolderConflictError = InstanceType<typeof InventoryFolderConflictError>;

/** A filing request named items filed in another tier (a 400 at the route). */
export const InventoryItemNotInLocationError = errors.NotInLocationError;
export type InventoryItemNotInLocationError = InstanceType<typeof InventoryItemNotInLocationError>;

/** A folder as the browser and the folder routes see it. */
export type InventoryFolder = ItemFolder;

const family = defineItemFolderFamily(INVENTORY_FOLDER_RULES, '.json', errors);

/** A folder an existing object carries, in normal form or the root. */
export const normalizeInventoryFolderPathOrRoot = family.normalizeOrRoot;

/** True when `path` is structurally safe to write under `Inventory/`. */
export const isSafeInventoryFolderPath = family.isSafe;

/** Resolve an operator's requested folder against the folders a tier already has. */
export const resolveInventoryFolder = family.resolve;

/** True when `path` is already in normal form. */
export const isValidInventoryFolderPath = family.isValid;

/** The folder an `Inventory/` document lives in: `Inventory/A/B/x.json` → `A/B`. */
export const folderOfInventoryPath = family.folderOf;

/**
 * True for a document path that can hold an Inventory object: a `.json` file
 * anywhere under `Inventory/` except under `Inventory/images/`. Whether its
 * content parses is `isInventoryItemDocument`'s question.
 */
export const isInventoryItemDocumentPath = family.isDocumentPath;
