/**
 * Inventory folders — the rules for the operator's filing inside a tier's
 * `Inventory/` folder. Exactly the wardrobe's rules (`wardrobe-folders.md`
 * §2): the path is the truth, `''` is the root, at most eight segments,
 * `images` reserved at any depth, case-insensitively unique siblings.
 *
 * Every helper is a delegate over {@link INVENTORY_FOLDER_RULES}; the rules
 * live once in `lib/mount-index/item-folders.ts`.
 *
 * Client-safe: pure, no server imports.
 *
 * @module lib/inventory/folders
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
  normalizeItemFolderName,
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

/** A folder path that breaks the rules (a 400 at the route). */
export class InventoryFolderPathError extends ItemFolderPathError {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryFolderPathError';
  }
}

/** The folder named doesn't exist (a 404 at the route). */
export class InventoryFolderNotFoundError extends ItemFolderNotFoundError {
  constructor(folder: string) {
    super(folder, 'inventory');
    this.name = 'InventoryFolderNotFoundError';
  }
}

/** The folder change collides with what's already there (a 409 at the route). */
export class InventoryFolderConflictError extends ItemFolderConflictError {
  constructor(folder: string, message?: string) {
    super(folder, message, 'inventory');
    this.name = 'InventoryFolderConflictError';
  }
}

/** A filing request named objects filed in another tier (a 400 at the route). */
export class InventoryItemNotInLocationError extends ItemNotInLocationError {
  constructor(itemIds: string[]) {
    super(itemIds, 'inventory');
    this.name = 'InventoryItemNotInLocationError';
  }
}

/** A folder as the browser and the folder routes see it. */
export type InventoryFolder = ItemFolder;

const pathError = (message: string) => new InventoryFolderPathError(message);

/** A folder an existing object carries, in normal form or the root. */
export function normalizeInventoryFolderPathOrRoot(input: string | null | undefined): string {
  return normalizeItemFolderPathOrRoot(INVENTORY_FOLDER_RULES, input);
}

/** Normalise a folder *name* — one segment, as a rename takes it. */
export function normalizeInventoryFolderName(input: string | null | undefined): string {
  return normalizeItemFolderName(INVENTORY_FOLDER_RULES, input, pathError);
}

/** True when `path` is structurally safe to write under `Inventory/`. */
export function isSafeInventoryFolderPath(path: string): boolean {
  return isSafeItemFolderPath(INVENTORY_FOLDER_RULES, path);
}

/** Resolve an operator's requested folder against the folders a tier already has. */
export function resolveInventoryFolder(existing: readonly string[], requested: string | null | undefined): string {
  return resolveItemFolder(INVENTORY_FOLDER_RULES, existing, requested, pathError);
}

/** True when `path` is already in normal form. */
export function isValidInventoryFolderPath(path: string): boolean {
  return isValidItemFolderPath(INVENTORY_FOLDER_RULES, path);
}

/** The folder an `Inventory/` document lives in: `Inventory/A/B/x.json` → `A/B`. */
export function folderOfInventoryPath(relativePath: string): string {
  return folderOfItemPath(INVENTORY_FOLDER_RULES, relativePath);
}

/**
 * True for a document path that can hold an Inventory object: a `.json` file
 * anywhere under `Inventory/` except under `Inventory/images/`. Whether its
 * content parses is `isInventoryItemDocument`'s question.
 */
export function isInventoryItemDocumentPath(relativePath: string): boolean {
  return isItemDocumentPath(INVENTORY_FOLDER_RULES, relativePath, '.json');
}
