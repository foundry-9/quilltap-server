/**
 * Folder filing with components — moving or copying items to a folder within
 * one wardrobe, with an outfit's components brought along (or not).
 *
 * The folder twin of the cross-wardrobe transfer (`/api/v1/wardrobe/transfers`):
 * the same all-or-nothing `components` choice, gathered by the same walk
 * (`collectContainerComponents` — only components filed in this wardrobe
 * travel; pieces borrowed from a shared tier stay put).
 *
 *   - **move**, components `none` — the items alone (`moveItemsToFolder`).
 *   - **move**, components `move` — the items and their components, one
 *     batch, ids kept.
 *   - **move**, components `copy` — fresh copies of the components land in the
 *     folder; the moved outfits are rewired to them, the originals stay put.
 *   - **copy**, components `none` — copies of the items, still naming the
 *     original components.
 *   - **copy**, components `copy` — copies of the items and their components,
 *     the copied outfits rewired to the copied pieces.
 *
 * A copy lives beside its original in the same wardrobe, so it takes the next
 * free `(copy)` title (`nextCopyTitle`, as Duplicate does) — a title the
 * wardrobe already holds would make the vault fall back from slug references
 * to UUIDs. It mints a fresh id (a new garment, empty wear ledger) and its
 * pictures are copied under that id. Whenever both an outfit and one of its
 * pieces are copied, the copy names the copy.
 *
 * Server-only.
 *
 * @module lib/wardrobe/folder-filing
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { isComposite, type WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { collectContainerComponents } from '@/lib/wardrobe/expand-composites';
import { WardrobeItemNotInLocationError } from '@/lib/wardrobe/folders';
import { carryItemImages } from '@/lib/wardrobe/item-images';
import { createItem, moveItemsToFolder } from '@/lib/wardrobe/item-mutations';
import type { WardrobeLocation } from '@/lib/wardrobe/location';
import { nextCopyTitle } from '@/lib/wardrobe/next-copy-title';

/** What travels with an outfit filed into a folder: its components, or nothing. */
export type FolderComponentMode = 'move' | 'copy' | 'none';

export interface FileItemsToFolderRequest {
  action: 'move' | 'copy';
  itemIds: readonly string[];
  folder: string;
  components?: FolderComponentMode;
}

export interface FileItemsToFolderResult {
  /** The requested items as they now stand — moved originals, or their copies. */
  items: WardrobeItem[];
  /** How many components travelled along (moved or copied). */
  componentsCarried: number;
}

/** Thrown for a combination that cannot be honoured (a 400). */
export class FolderFilingRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolderFilingRequestError';
  }
}

/**
 * Move or copy items into one folder of a wardrobe, bringing composites'
 * same-wardrobe components along as asked. Every id must be filed in this
 * wardrobe; a borrowed one refuses the batch before anything is written.
 */
export async function fileItemsToFolder(
  repos: RepositoryContainer,
  userId: string,
  location: WardrobeLocation,
  request: FileItemsToFolderRequest,
): Promise<FileItemsToFolderResult> {
  const { action, folder } = request;
  const componentMode: FolderComponentMode = request.components ?? 'none';
  if (action === 'copy' && componentMode === 'move') {
    throw new FolderFilingRequestError(
      'Copying an outfit cannot move its components — the original outfit still needs them',
    );
  }

  // The plain move needs no plan.
  if (action === 'move' && componentMode === 'none') {
    const items = await moveItemsToFolder(location, request.itemIds, folder);
    return { items, componentsCarried: 0 };
  }

  const target = await location.resolveFolder(folder);
  const uniqueIds = Array.from(new Set(request.itemIds));
  const wardrobeItems = await location.readItems(true);
  const byId = new Map(wardrobeItems.map((item) => [item.id, item]));
  const missing = uniqueIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new WardrobeItemNotInLocationError(missing);
  const requested = uniqueIds.map((id) => byId.get(id) as WardrobeItem);

  // Components already in the request are handled as requested items.
  const requestedIds = new Set(uniqueIds);
  const components =
    componentMode === 'none'
      ? []
      : collectContainerComponents(requested.filter(isComposite), wardrobeItems).filter(
          (item) => !requestedIds.has(item.id),
        );

  if (action === 'move' && componentMode === 'move') {
    const moved = await moveItemsToFolder(location, [...uniqueIds, ...components.map((c) => c.id)], target);
    logFiled(location, action, componentMode, target, uniqueIds.length, components.length);
    return { items: moved.slice(0, uniqueIds.length), componentsCarried: components.length };
  }

  // Everything that remains mints copies: every component (components `copy`)
  // and, for a copy, every requested item too.
  const toCopy = action === 'copy' ? [...components, ...requested] : components;
  const idMap = new Map(toCopy.map((item) => [item.id, randomUUID()]));
  const remap = (ids: readonly string[]): string[] => ids.map((id) => idMap.get(id) ?? id);
  const takenTitles = wardrobeItems.map((item) => item.title);
  const mountPointId = await location.writableMountPointId();
  const now = new Date().toISOString();

  // Components first, so an outfit's references resolve the moment it lands.
  const copies = new Map<string, WardrobeItem>();
  for (const original of toCopy) {
    const title = nextCopyTitle(original.title, takenTitles);
    takenTitles.push(title);
    const id = idMap.get(original.id) as string;
    const { fileIdMap } = await carryItemImages(repos, {
      mode: 'copy',
      sourceItemId: original.id,
      destinationItemId: id,
      destinationMountPointId: mountPointId,
      userId,
    });
    const stored = await createItem(
      location,
      {
        ...original,
        title,
        folder: target,
        componentItemIds: remap(original.componentItemIds),
      },
      {
        preserve: {
          id,
          createdAt: now,
          updatedAt: now,
          archivedAt: original.archivedAt ?? null,
          imageFileId: original.imageFileId ? fileIdMap.get(original.imageFileId) ?? null : null,
          migratedFromClothingRecordId: original.migratedFromClothingRecordId ?? null,
        },
      },
    );
    copies.set(original.id, stored);
  }

  let items: WardrobeItem[];
  if (action === 'copy') {
    items = requested.map((item) => copies.get(item.id) as WardrobeItem);
  } else {
    // Move with copied components: the outfits move and are rewired to the copies.
    items = await location.updateMany(
      requested.map((item) => ({
        id: item.id,
        patch: {
          folder: target,
          ...(isComposite(item) ? { componentItemIds: remap(item.componentItemIds) } : {}),
        },
      })),
      { requireAll: true },
    );
  }

  logFiled(location, action, componentMode, target, uniqueIds.length, components.length);
  return { items, componentsCarried: components.length };
}

function logFiled(
  location: WardrobeLocation,
  action: 'move' | 'copy',
  componentMode: FolderComponentMode,
  folder: string,
  requested: number,
  componentsCarried: number,
): void {
  logger.debug('[FolderFiling] Filed wardrobe items into folder', {
    scope: location.scope,
    mountPointId: location.mountPointId,
    action,
    componentMode,
    folder,
    requested,
    componentsCarried,
    context: 'wardrobe',
  });
}
