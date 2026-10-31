/**
 * Folder mutations — the one way a wardrobe folder is created, renamed or
 * deleted. The folder routes (all four tiers, through the route factory) call
 * these; the normalisation, logging and work are the shared item-folder
 * mutations (`lib/mount-index/item-folder-location.ts`) under the wardrobe's
 * rules.
 *
 * Server-only.
 *
 * @module lib/wardrobe/folder-mutations
 */

import {
  createItemFolder,
  deleteItemFolder,
  renameItemFolder,
  type ItemFolderKind,
} from '@/lib/mount-index/item-folder-location';
import {
  WARDROBE_FOLDER_RULES,
  WardrobeFolderPathError,
  type WardrobeFolder,
} from '@/lib/wardrobe/folders';
import type { WardrobeLocation } from '@/lib/wardrobe/location';

/** The wardrobe's folder kind: its rules and its path error. */
export const WARDROBE_FOLDER_KIND: ItemFolderKind = {
  rules: WARDROBE_FOLDER_RULES,
  pathError: (message) => new WardrobeFolderPathError(message),
};

/** Create a folder at a location (an existing one, in any casing, is answered). */
export function createWardrobeFolder(location: WardrobeLocation, path: string): Promise<WardrobeFolder> {
  return createItemFolder(WARDROBE_FOLDER_KIND, location, path);
}

/** Rename a folder in place; its items follow because the path is the truth. */
export function renameWardrobeFolder(location: WardrobeLocation, path: string, name: string): Promise<WardrobeFolder> {
  return renameItemFolder(WARDROBE_FOLDER_KIND, location, path, name);
}

/** Delete a folder, sending its items and subfolders up to its parent. */
export function deleteWardrobeFolder(
  location: WardrobeLocation,
  path: string,
): Promise<{ movedItems: number; movedFolders: number }> {
  return deleteItemFolder(WARDROBE_FOLDER_KIND, location, path);
}
