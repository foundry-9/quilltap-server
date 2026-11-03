/**
 * The folder half of a tiered item location (the wardrobe's `Wardrobe/`, the
 * Inventory's `Inventory/`), stated once: the interface both locations
 * extend, and the mutations every folder route calls — create, rename,
 * delete, and filing a batch of items into one folder — with their
 * normalisation and logging in one place. The location does the work
 * (`vault-overlay/item-folder-ops.ts` underneath).
 *
 * Folders are the operator's filing. An item's folder is its path under the
 * tier's root and nothing else: a rename moves the files, a delete sends
 * them up a level, and nothing here ever deletes an item.
 *
 * Server-only.
 *
 * @module lib/mount-index/item-folder-location
 */

import { logger } from '@/lib/logger';
import {
  normalizeItemFolderName,
  type ItemFolder,
  type ItemFolderRules,
} from '@/lib/mount-index/item-folders';

/** What deleting a folder moved, and where to. */
export interface DeletedItemFolder {
  movedItems: number;
  movedFolders: number;
  parent: string;
}

/** The folder operations every tiered item location offers. */
export interface ItemFolderLocation {
  scope: 'character' | 'group' | 'project' | 'general';
  /** Owner id; null for General. */
  id: string | null;
  /** The mount holding the tier's root folder. */
  mountPointId: string;
  /** The owning character — `character` scope only. */
  characterId: string | null;
  /** Every folder under the root (empty ones included), with direct item counts. */
  listFolders(): Promise<ItemFolder[]>;
  /**
   * Resolve an operator's requested folder against this tier's folders: an
   * existing folder as stored, else the new part normalised. Throws the
   * kind's path error.
   */
  resolveFolder(requested: string): Promise<string>;
  /** Create a folder (normalised path); an existing one in any casing is answered. */
  createFolder(path: string): Promise<ItemFolder>;
  /** Rename a folder in place to `newName` (one normalised segment). */
  renameFolder(path: string, newName: string): Promise<ItemFolder>;
  /** Delete a folder, sending its items and subfolders up to its parent. */
  deleteFolder(path: string): Promise<DeletedItemFolder>;
  /**
   * The mount, checked for writing: throws `CharacterArchivedError` for an
   * archived character.
   */
  writableMountPointId(): Promise<string>;
}

/** A location that can re-file its own items (the batch `move-items`). */
export interface ItemFilingLocation<T> extends ItemFolderLocation {
  updateMany(
    patches: Array<{ id: string; patch: { folder: string } }>,
    opts?: { requireAll?: boolean },
  ): Promise<T[]>;
}

/** What tells one kind's folders from another's: its rules and its path error. */
export interface ItemFolderKind {
  rules: ItemFolderRules;
  pathError: (message: string) => Error;
}

/** A key that names one folder tree, for "same source and destination?" checks. */
export function locationKey(loc: Pick<ItemFolderLocation, 'scope' | 'mountPointId'>): string {
  return `${loc.scope}:${loc.mountPointId}`;
}

function trimFolderPath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, '');
}

function logFolderOp(op: string, kind: ItemFolderKind, location: ItemFolderLocation, meta: Record<string, unknown>): void {
  logger.debug(`[ItemFolders] ${op}`, {
    kind: kind.rules.noun,
    scope: location.scope,
    mountPointId: location.mountPointId,
    ...meta,
    context: kind.rules.noun,
  });
}

/** Create a folder at a location (an existing one, in any casing, is answered). */
export async function createItemFolder(
  kind: ItemFolderKind,
  location: ItemFolderLocation,
  path: string,
): Promise<ItemFolder> {
  const resolved = await location.resolveFolder(path);
  if (!resolved) throw kind.pathError('A folder needs a name');
  const folder = await location.createFolder(resolved);
  logFolderOp('Created folder', kind, location, { requested: path, folder: folder.path, itemCount: folder.itemCount });
  return folder;
}

/** Rename a folder in place; its items follow because the path is the truth. */
export async function renameItemFolder(
  kind: ItemFolderKind,
  location: ItemFolderLocation,
  path: string,
  name: string,
): Promise<ItemFolder> {
  // The folder named is an existing one, matched as stored (hand-made
  // spellings included); the store answers a missing one with a 404.
  const from = trimFolderPath(path);
  const folder = await location.renameFolder(from, normalizeItemFolderName(kind.rules, name, kind.pathError));
  logFolderOp('Renamed folder', kind, location, { from, to: folder.path, itemCount: folder.itemCount });
  return folder;
}

/** Delete a folder, sending its items and subfolders up to its parent. */
export async function deleteItemFolder(
  kind: ItemFolderKind,
  location: ItemFolderLocation,
  path: string,
): Promise<{ movedItems: number; movedFolders: number }> {
  const folder = trimFolderPath(path);
  const { movedItems, movedFolders, parent } = await location.deleteFolder(folder);
  logFolderOp('Deleted folder', kind, location, { folder, parent, movedItems, movedFolders });
  return { movedItems, movedFolders };
}

/**
 * File several items into one folder at a location, with one read and one
 * projection. Every id must be an item of this location — a borrowed item
 * (one shown in a character's view from a shared tier) refuses the batch,
 * naming it, before anything moves. Returns the moved items as written.
 */
export async function moveItemsToFolderIn<T>(
  kind: ItemFolderKind,
  location: ItemFilingLocation<T>,
  itemIds: readonly string[],
  folder: string,
): Promise<T[]> {
  const target = await location.resolveFolder(folder);
  const uniqueIds = Array.from(new Set(itemIds));
  const moved = await location.updateMany(
    uniqueIds.map((id) => ({ id, patch: { folder: target } })),
    { requireAll: true },
  );
  logFolderOp('Moved items to folder', kind, location, { folder: target, requested: uniqueIds.length, moved: moved.length });
  return moved;
}
