/**
 * Folder mutations — the one way a wardrobe folder is created, renamed or
 * deleted. The folder routes (all four tiers, through the route factory) call
 * these, so the normalisation rules (`lib/wardrobe/folders.ts`) and the
 * logging live in one place; the location does the work.
 *
 * Folders are the operator's filing. An item's folder is its path under
 * `Wardrobe/` and nothing else: a rename moves the files, a delete sends
 * them up a level, and nothing here ever deletes an item.
 *
 * Server-only.
 *
 * @module lib/wardrobe/folder-mutations
 */

import { logger } from '@/lib/logger';
import {
  normalizeWardrobeFolderName,
  normalizeWardrobeFolderPath,
  type WardrobeFolder,
} from '@/lib/wardrobe/folders';
import type { WardrobeLocation } from '@/lib/wardrobe/location';

/** Create a folder at a location (an existing one, in any casing, is answered). */
export async function createWardrobeFolder(
  location: WardrobeLocation,
  path: string,
): Promise<WardrobeFolder> {
  const folder = await location.createFolder(normalizeWardrobeFolderPath(path));
  logger.debug('[FolderMutations] Created wardrobe folder', {
    scope: location.scope,
    mountPointId: location.mountPointId,
    requested: path,
    folder: folder.path,
    itemCount: folder.itemCount,
    context: 'wardrobe',
  });
  return folder;
}

/** Rename a folder in place; its items follow because the path is the truth. */
export async function renameWardrobeFolder(
  location: WardrobeLocation,
  path: string,
  name: string,
): Promise<WardrobeFolder> {
  const from = normalizeWardrobeFolderPath(path);
  const folder = await location.renameFolder(from, normalizeWardrobeFolderName(name));
  logger.debug('[FolderMutations] Renamed wardrobe folder', {
    scope: location.scope,
    mountPointId: location.mountPointId,
    from,
    to: folder.path,
    itemCount: folder.itemCount,
    context: 'wardrobe',
  });
  return folder;
}

/** Delete a folder, sending its items and subfolders up to its parent. */
export async function deleteWardrobeFolder(
  location: WardrobeLocation,
  path: string,
): Promise<{ movedItems: number; movedFolders: number }> {
  const folder = normalizeWardrobeFolderPath(path);
  const { movedItems, movedFolders, parent } = await location.deleteFolder(folder);
  logger.debug('[FolderMutations] Deleted wardrobe folder', {
    scope: location.scope,
    mountPointId: location.mountPointId,
    folder,
    parent,
    movedItems,
    movedFolders,
    context: 'wardrobe',
  });
  return { movedItems, movedFolders };
}
