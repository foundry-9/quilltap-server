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
  WardrobeFolderPathError,
  type WardrobeFolder,
} from '@/lib/wardrobe/folders';
import type { WardrobeLocation } from '@/lib/wardrobe/location';

/** Create a folder at a location (an existing one, in any casing, is answered). */
export async function createWardrobeFolder(
  location: WardrobeLocation,
  path: string,
): Promise<WardrobeFolder> {
  const resolved = await location.resolveFolder(path);
  if (!resolved) throw new WardrobeFolderPathError('A folder needs a name');
  const folder = await location.createFolder(resolved);
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
  // The folder named is an existing one, matched as stored (hand-made
  // spellings included); the store answers a missing one with a 404.
  const from = path.trim().replace(/^\/+|\/+$/g, '');
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
  const folder = path.trim().replace(/^\/+|\/+$/g, '');
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
