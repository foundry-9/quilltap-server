/**
 * Wardrobe item pictures — the one place an item's image history is read and
 * its `imageFileId` written.
 *
 * Storage (see `lib/file-storage/wardrobe-image-bridge.ts`): each picture's
 * bytes are a blob link under `Wardrobe/images/<itemId>/` in the item's own
 * tier mount, plus a `files` row (`linkedTo: [itemId]`, category IMAGE) that
 * gives it a URL, a thumbnail and the generation prompt on record. The row's
 * `originalFilename` is the link's leaf name, so the link is always
 * `Wardrobe/images/<itemId>/<originalFilename>` in the mount its storageKey
 * names.
 *
 * The history is `files.findByLinkedTo(itemId)` filtered to IMAGE, newest
 * first — never a frontmatter list. The frontmatter carries only the current
 * pick, `imageFileId`, and this module is the only writer of it (the PUT item
 * routes validate a hand-chosen value through {@link assertItemImageChoice}).
 *
 * Server-only.
 *
 * @module lib/wardrobe/item-images
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import {
  resolveWardrobeMount,
  updateProjectWardrobeItem,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import {
  deleteWardrobeItemImageLink,
  writeWardrobeItemImage,
  type WardrobeImageKind,
} from '@/lib/file-storage/wardrobe-image-bridge';
import {
  buildMountBlobStorageKey,
  parseMountBlobStorageKey,
  readMountBlob,
} from '@/lib/file-storage/project-store-bridge';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { FileEntry, FileSource } from '@/lib/schemas/file.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { resolveWardrobeContainer } from '@/lib/wardrobe/resolve-container';
import type { WardrobeContainerScope } from '@/lib/wardrobe/wardrobe-container';

const LOG_CONTEXT = 'wardrobe.item-images';

/** Thrown when a requested image is not one of the item's own. */
export class ForeignWardrobeImageError extends Error {
  constructor(itemId: string, fileId: string) {
    super(`File ${fileId} is not an image of wardrobe item ${itemId}`);
    this.name = 'ForeignWardrobeImageError';
  }
}

// ============================================================================
// The item's home
// ============================================================================

/** An item located in its container, with the means to write it back. */
export interface WardrobeItemHome {
  scope: WardrobeContainerScope;
  /** The owning character — `character` scope only. */
  characterId: string | null;
  item: WardrobeItem;
  /** Every item in the container (archived included). */
  containerItems: WardrobeItem[];
  /**
   * The mount holding the item's markdown — where its pictures go. Throws
   * `CharacterArchivedError` for an archived character's item (the tombstone);
   * callers let it propagate, never fall back.
   */
  resolveMount(): Promise<string>;
  /** Patch the item through its tier's ordinary update chokepoint. */
  update(patch: Partial<WardrobeItem>): Promise<WardrobeItem | null>;
}

/**
 * The mount a container's items live in. `resolveWardrobeMount` throws for an
 * archived character — that is the point.
 */
export async function resolveContainerMountPointId(
  scope: WardrobeContainerScope,
  characterId: string | null,
  mountPointId: string | null,
): Promise<string> {
  if (scope === 'project' || scope === 'group') {
    if (!mountPointId) throw new Error(`No store mount resolved for ${scope} wardrobe`);
    return mountPointId;
  }
  if (scope === 'general') {
    const general = await getGeneralMountPointId();
    if (!general) throw new Error('Quilltap General is not provisioned');
    return general;
  }
  const loc = await resolveWardrobeMount(characterId);
  if (!loc) throw new Error(`Character ${characterId} has no linked vault`);
  return loc.mountPointId;
}

/**
 * Find `itemId` in the named container, or null when the container does not
 * resolve or does not hold the item (a General archetype is not in a
 * character's own wardrobe, even though the character's reads merge it in).
 */
export async function resolveWardrobeItemHome(
  repos: RepositoryContainer,
  userId: string,
  scope: WardrobeContainerScope,
  containerId: string | null | undefined,
  itemId: string,
): Promise<WardrobeItemHome | null> {
  const container = await resolveWardrobeContainer(scope, containerId, repos, userId);
  if (!container) return null;

  const containerItems = await container.readItems();
  const item = containerItems.find(
    (i) => i.id === itemId && (scope !== 'character' || i.characterId === container.characterId),
  );
  if (!item) return null;

  const { characterId, mountPointId } = container;
  return {
    scope,
    characterId,
    item,
    containerItems,
    resolveMount: () => resolveContainerMountPointId(scope, characterId, mountPointId),
    update: (patch) => {
      if (scope === 'project' || scope === 'group') {
        return updateProjectWardrobeItem(mountPointId as string, itemId, patch);
      }
      return repos.wardrobe.update(itemId, patch, scope === 'character' ? characterId : null);
    },
  };
}

// ============================================================================
// History
// ============================================================================

/** One picture as the client sees it. */
export interface WardrobeItemImageSummary {
  fileId: string;
  url: string;
  thumbnailUrl: string;
  source: FileSource;
  createdAt: string;
  prompt?: string;
  model?: string;
}

export function wardrobeImageUrl(fileId: string): string {
  return `/api/v1/files/${fileId}`;
}

export function wardrobeImageThumbnailUrl(fileId: string): string {
  return `/api/v1/files/${fileId}?action=thumbnail`;
}

export function toWardrobeImageSummary(file: FileEntry): WardrobeItemImageSummary {
  return {
    fileId: file.id,
    url: wardrobeImageUrl(file.id),
    thumbnailUrl: wardrobeImageThumbnailUrl(file.id),
    source: file.source,
    createdAt: file.createdAt,
    ...(file.generationPrompt ? { prompt: file.generationPrompt } : {}),
    ...(file.generationModel ? { model: file.generationModel } : {}),
  };
}

/** The item's pictures, newest first. */
export async function listWardrobeItemImages(
  repos: Pick<RepositoryContainer, 'files'>,
  itemId: string,
): Promise<FileEntry[]> {
  const files = await repos.files.findByLinkedTo(itemId);
  return files
    .filter((f) => f.category === 'IMAGE')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/**
 * Refuse an `imageFileId` that is not one of the item's own pictures. `null`
 * (clear the picture) is always allowed. The PUT item routes call this before
 * passing a hand-set `imageFileId` through.
 */
export async function assertItemImageChoice(
  repos: Pick<RepositoryContainer, 'files'>,
  itemId: string,
  fileId: string | null | undefined,
): Promise<void> {
  if (fileId === undefined || fileId === null) return;
  const images = await listWardrobeItemImages(repos, itemId);
  if (!images.some((f) => f.id === fileId)) {
    throw new ForeignWardrobeImageError(itemId, fileId);
  }
}

// ============================================================================
// Writes
// ============================================================================

const SOURCE_BY_KIND: Record<WardrobeImageKind, FileSource> = {
  generated: 'GENERATED',
  uploaded: 'UPLOADED',
  imported: 'IMPORTED',
};

export interface AddWardrobeItemImageInput {
  userId: string;
  kind: WardrobeImageKind;
  content: Buffer;
  contentType: string;
  width?: number | null;
  height?: number | null;
  generationPrompt?: string | null;
  generationModel?: string | null;
  generationRevisedPrompt?: string | null;
}

/**
 * Store a new picture for the item and make it current: bridge write, `files`
 * row, then one item update. The update is not deferred — the editor expects
 * the current pointer to be durable when the response returns.
 */
export async function addWardrobeItemImage(
  repos: RepositoryContainer,
  home: WardrobeItemHome,
  input: AddWardrobeItemImageInput,
): Promise<{ file: FileEntry; item: WardrobeItem | null }> {
  const mountPointId = await home.resolveMount();
  const description = `Wardrobe image for “${home.item.title}”`;

  const written = await writeWardrobeItemImage({
    mountPointId,
    itemId: home.item.id,
    kind: input.kind,
    content: input.content,
    contentType: input.contentType,
    description,
  });

  const file = await repos.files.create(
    {
      userId: input.userId,
      sha256: written.sha256,
      originalFilename: written.leafName,
      mimeType: written.storedMimeType,
      size: written.sizeBytes,
      width: input.width ?? null,
      height: input.height ?? null,
      linkedTo: [home.item.id],
      source: SOURCE_BY_KIND[input.kind],
      category: 'IMAGE',
      generationPrompt: input.generationPrompt ?? null,
      generationModel: input.generationModel ?? null,
      generationRevisedPrompt: input.generationRevisedPrompt ?? null,
      description,
      tags: [home.item.id],
      storageKey: written.storageKey,
      projectId: null,
      folderPath: null,
    },
    { id: randomUUID() },
  );

  const item = await home.update({ imageFileId: file.id });

  logger.info('[WardrobeImages] Added wardrobe item image', {
    context: LOG_CONTEXT,
    scope: home.scope,
    itemId: home.item.id,
    fileId: file.id,
    kind: input.kind,
    sizeBytes: written.sizeBytes,
  });

  return { file, item };
}

/** Make one of the item's own pictures current. */
export async function setCurrentWardrobeItemImage(
  repos: RepositoryContainer,
  home: WardrobeItemHome,
  fileId: string,
): Promise<string> {
  await assertItemImageChoice(repos, home.item.id, fileId);
  // A tombstone refuses here, before the write, the way every other write does.
  await home.resolveMount();
  await home.update({ imageFileId: fileId });
  logger.debug('[WardrobeImages] Set current wardrobe item image', {
    context: LOG_CONTEXT,
    itemId: home.item.id,
    fileId,
  });
  return fileId;
}

/**
 * Remove one picture's mount link and `files` row. The blob goes only when no
 * sibling still links it (`deleteWithGC`). Never throws on a missing link.
 */
async function removeImageFile(repos: RepositoryContainer, itemId: string, file: FileEntry): Promise<void> {
  const parsed = parseMountBlobStorageKey(file.storageKey ?? '');
  if (parsed) {
    await deleteWardrobeItemImageLink(parsed.mountPointId, itemId, file.originalFilename);
  }
  await repos.files.delete(file.id);
}

/**
 * Delete one of the item's pictures. When it was current, the next-newest
 * becomes current (or none). Returns the new current id.
 */
export async function deleteWardrobeItemImage(
  repos: RepositoryContainer,
  home: WardrobeItemHome,
  fileId: string,
): Promise<string | null> {
  const images = await listWardrobeItemImages(repos, home.item.id);
  const target = images.find((f) => f.id === fileId);
  if (!target) throw new ForeignWardrobeImageError(home.item.id, fileId);

  // Refuse a tombstone before touching anything.
  await home.resolveMount();
  await removeImageFile(repos, home.item.id, target);

  let current = home.item.imageFileId ?? null;
  if (current === fileId || (current && !images.some((f) => f.id === current))) {
    current = images.find((f) => f.id !== fileId)?.id ?? null;
    await home.update({ imageFileId: current });
  }

  logger.info('[WardrobeImages] Deleted wardrobe item image', {
    context: LOG_CONTEXT,
    itemId: home.item.id,
    fileId,
    current,
  });
  return current;
}

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * Drop every picture of a deleted item: each mount link (`deleteWithGC`) and
 * each `files` row. Called by all three delete routes after the item is gone;
 * a composite's deletion takes only its own pictures, never its components'.
 * Logs (never throws).
 */
export async function cleanupItemImages(
  repos: RepositoryContainer,
  itemId: string,
  logTag: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    const images = await listWardrobeItemImages(repos, itemId);
    for (const file of images) {
      await removeImageFile(repos, itemId, file);
    }
    if (images.length > 0) {
      logger.info(`${logTag} Removed wardrobe item images with the item`, {
        ...meta,
        itemId,
        count: images.length,
      });
    }
  } catch (error) {
    logger.warn(`${logTag} Cleanup of wardrobe item images had issues`, {
      ...meta,
      itemId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Carry an item's pictures to another mount for a transfer.
 *
 * - `move` (same item id): each picture is re-linked at the same relative path
 *   in the destination (the same bytes de-duplicate to one blob), its `files`
 *   row re-pointed at the new storage key. The source links are returned for
 *   {@link dropSourceImageLinks} once the source item is gone.
 * - `copy` (fresh item id): each picture is linked under the new id, with a
 *   new `files` row linked to the new item. Returns the old → new file id map
 *   so the copy's `imageFileId` points at its own copy.
 */
export async function carryItemImages(
  repos: RepositoryContainer,
  args: {
    mode: 'move' | 'copy';
    sourceItemId: string;
    destinationItemId: string;
    destinationMountPointId: string;
    userId: string;
  },
): Promise<{ fileIdMap: Map<string, string>; sourceLinks: Array<{ mountPointId: string; leafName: string }> }> {
  const fileIdMap = new Map<string, string>();
  const sourceLinks: Array<{ mountPointId: string; leafName: string }> = [];
  const images = await listWardrobeItemImages(repos, args.sourceItemId);

  for (const file of images) {
    const parsed = parseMountBlobStorageKey(file.storageKey ?? '');
    const bytes = file.storageKey ? await readMountBlob(file.storageKey) : null;
    if (!parsed || !bytes) {
      logger.warn('[WardrobeImages] Wardrobe image has no readable blob; not carried', {
        context: LOG_CONTEXT,
        fileId: file.id,
        itemId: args.sourceItemId,
      });
      continue;
    }

    const written = await writeWardrobeItemImage({
      mountPointId: args.destinationMountPointId,
      itemId: args.destinationItemId,
      kind: file.source === 'GENERATED' ? 'generated' : file.source === 'IMPORTED' ? 'imported' : 'uploaded',
      content: bytes,
      contentType: file.mimeType,
      description: file.description ?? undefined,
      leafName: file.originalFilename,
    });
    const storageKey = buildMountBlobStorageKey(args.destinationMountPointId, written.blobId);

    if (args.mode === 'move') {
      await repos.files.update(file.id, { storageKey });
      if (parsed.mountPointId !== args.destinationMountPointId) {
        sourceLinks.push({ mountPointId: parsed.mountPointId, leafName: file.originalFilename });
      }
      fileIdMap.set(file.id, file.id);
    } else {
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = file;
      const copy = await repos.files.create(
        {
          ...rest,
          originalFilename: written.leafName,
          linkedTo: [args.destinationItemId],
          tags: [args.destinationItemId],
          storageKey,
        },
        { id: randomUUID() },
      );
      fileIdMap.set(file.id, copy.id);
    }
  }

  if (images.length > 0) {
    logger.info('[WardrobeImages] Carried wardrobe item images for transfer', {
      context: LOG_CONTEXT,
      mode: args.mode,
      sourceItemId: args.sourceItemId,
      destinationItemId: args.destinationItemId,
      destinationMountPointId: args.destinationMountPointId,
      count: fileIdMap.size,
    });
  }
  return { fileIdMap, sourceLinks };
}

/** After a move: drop the source mount's links (`deleteWithGC`; the blob survives via the new link). */
export async function dropSourceImageLinks(
  itemId: string,
  sourceLinks: ReadonlyArray<{ mountPointId: string; leafName: string }>,
): Promise<void> {
  let dropped = 0;
  for (const link of sourceLinks) {
    try {
      if (await deleteWardrobeItemImageLink(link.mountPointId, itemId, link.leafName)) dropped++;
    } catch (error) {
      logger.warn('[WardrobeImages] Failed to drop a source image link after move', {
        context: LOG_CONTEXT,
        itemId,
        mountPointId: link.mountPointId,
        leafName: link.leafName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (sourceLinks.length > 0) {
    logger.info('[WardrobeImages] Dropped source image links after move', {
      context: LOG_CONTEXT,
      itemId,
      dropped,
    });
  }
}
