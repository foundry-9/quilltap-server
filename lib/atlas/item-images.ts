/**
 * Atlas entry pictures — the Inventory's object pictures, over `Atlas/images/`.
 *
 * Each picture's bytes are a blob link under `Atlas/images/<entryId>/` in the
 * entry's own tier mount, plus a `files` row (`linkedTo: [entryId]`, category
 * IMAGE). The history is `files.findByLinkedTo(entryId)`; the entry file
 * carries only the current pick, `imageFileId`. The generic steps (listing,
 * the choice check, removal, transfer carry) are the wardrobe's, called with
 * the Atlas's images folder.
 *
 * A picture is for the operator — the editor, the viewer and the chip popup.
 * It is never sent to an image model as a reference (atlas spec §2).
 *
 * Server-only.
 *
 * @module lib/atlas/item-images
 */

import { logger } from '@/lib/logger';
import { writeWardrobeItemImage, type WardrobeImageKind } from '@/lib/file-storage/wardrobe-image-bridge';
import { createGeneratedFileRow } from '@/lib/files/generated-file-row';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { FileEntry, FileSource } from '@/lib/schemas/file.types';
import type { AtlasRecord } from '@/lib/schemas/atlas.types';
import {
  assertItemImageChoice,
  carryItemImages,
  cleanupItemImages,
  commitMovedImages,
  ForeignWardrobeImageError,
  listWardrobeItemImages,
  removeImageFile,
  toWardrobeImageSummary,
  type PendingImageMove,
  type WardrobeItemImageSummary,
} from '@/lib/wardrobe/item-images';
import { ATLAS_IMAGES_FOLDER } from '@/lib/atlas/folders';
import { resolveAtlasLocation, type AtlasLocation } from '@/lib/atlas/location';

const LOG_CONTEXT = 'atlas.item-images';

export { ATLAS_IMAGES_FOLDER, ForeignWardrobeImageError as ForeignAtlasImageError };
export type AtlasImageSummary = WardrobeItemImageSummary;

/** An entry located in its tier, with the means to write it back. */
export interface AtlasEntryHome {
  location: AtlasLocation;
  record: AtlasRecord;
  /** The same record, under the name the shared images route reads (`item.imageFileId`). */
  item: AtlasRecord;
}

/** The entry's pictures, newest first. */
export function listAtlasEntryImages(repos: Pick<RepositoryContainer, 'files'>, entryId: string): Promise<FileEntry[]> {
  return listWardrobeItemImages(repos, entryId);
}

/** The entry's pictures, as the gallery shows them. */
export async function listAtlasEntryImageSummaries(
  repos: Pick<RepositoryContainer, 'files'>,
  entryId: string,
): Promise<AtlasImageSummary[]> {
  return (await listAtlasEntryImages(repos, entryId)).map(toWardrobeImageSummary);
}

/** Refuse an `imageFileId` that is not one of the entry's own pictures. */
export function assertAtlasImageChoice(
  repos: Pick<RepositoryContainer, 'files'>,
  entryId: string,
  fileId: string | null | undefined,
): Promise<void> {
  return assertItemImageChoice(repos, entryId, fileId);
}

const SOURCE_BY_KIND: Record<WardrobeImageKind, FileSource> = {
  generated: 'GENERATED',
  uploaded: 'UPLOADED',
  imported: 'IMPORTED',
};

export interface AddAtlasEntryImageInput {
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

/** Store a new picture for the entry and make it current. */
export async function addAtlasEntryImage(
  repos: RepositoryContainer,
  home: AtlasEntryHome,
  input: AddAtlasEntryImageInput,
): Promise<{ file: FileEntry; record: AtlasRecord | null }> {
  const mountPointId = await home.location.writableMountPointId();
  const written = await writeWardrobeItemImage({
    mountPointId,
    itemId: home.record.id,
    kind: input.kind,
    content: input.content,
    contentType: input.contentType,
    description: `Atlas picture of “${home.record.name}”`,
    imagesFolder: ATLAS_IMAGES_FOLDER,
  });
  const file = await createGeneratedFileRow(repos, {
    userId: input.userId,
    sha256: written.sha256,
    originalFilename: written.leafName,
    stored: written,
    width: input.width ?? null,
    height: input.height ?? null,
    linkedTo: [home.record.id],
    tags: [home.record.id],
    source: SOURCE_BY_KIND[input.kind],
    generation: {
      prompt: input.generationPrompt ?? null,
      model: input.generationModel ?? null,
      revisedPrompt: input.generationRevisedPrompt ?? null,
    },
  });
  const record = await home.location.update(home.record.id, { imageFileId: file.id });
  logger.info('[AtlasImages] Added atlas entry picture', {
    context: LOG_CONTEXT,
    scope: home.location.scope,
    entryId: home.record.id,
    fileId: file.id,
    kind: input.kind,
    sizeBytes: written.sizeBytes,
  });
  return { file, record };
}

/** Make one of the entry's pictures current. */
export async function setCurrentAtlasEntryImage(repos: RepositoryContainer, home: AtlasEntryHome, fileId: string): Promise<string> {
  await assertAtlasImageChoice(repos, home.record.id, fileId);
  await home.location.writableMountPointId();
  await home.location.update(home.record.id, { imageFileId: fileId });
  logger.debug('[AtlasImages] Set current atlas entry picture', { context: LOG_CONTEXT, entryId: home.record.id, fileId });
  return fileId;
}

/** Delete one of the entry's pictures; the next-newest becomes current. */
export async function deleteAtlasEntryImage(
  repos: RepositoryContainer,
  home: AtlasEntryHome,
  fileId: string,
): Promise<string | null> {
  const images = await listAtlasEntryImages(repos, home.record.id);
  const target = images.find((f) => f.id === fileId);
  if (!target) throw new ForeignWardrobeImageError(home.record.id, fileId);
  await home.location.writableMountPointId();
  await removeImageFile(repos, home.record.id, target, ATLAS_IMAGES_FOLDER);
  let current = home.record.imageFileId ?? null;
  if (current === fileId || (current && !images.some((f) => f.id === current))) {
    current = images.find((f) => f.id !== fileId)?.id ?? null;
    await home.location.update(home.record.id, { imageFileId: current });
  }
  logger.info('[AtlasImages] Deleted atlas entry picture', { context: LOG_CONTEXT, entryId: home.record.id, fileId, current });
  return current;
}

/** Drop every picture of a deleted entry. Logs, never throws. */
export function cleanupAtlasEntryImages(
  repos: RepositoryContainer,
  entryId: string,
  logTag: string,
  meta: Record<string, unknown>,
): Promise<void> {
  return cleanupItemImages(repos, entryId, logTag, meta, ATLAS_IMAGES_FOLDER);
}

/** Carry an entry's pictures to another mount for a transfer. */
export function carryAtlasEntryImages(
  repos: RepositoryContainer,
  args: { mode: 'move' | 'copy'; sourceItemId: string; destinationItemId: string; destinationMountPointId: string; userId: string },
): Promise<{ fileIdMap: Map<string, string>; pendingMove: PendingImageMove }> {
  return carryItemImages(repos, { ...args, imagesFolder: ATLAS_IMAGES_FOLDER });
}

/** Finish a move's pictures once the entry has landed. */
export function commitMovedAtlasEntryImages(
  repos: Pick<RepositoryContainer, 'files'>,
  entryId: string,
  pending: PendingImageMove,
): Promise<void> {
  return commitMovedImages(repos, entryId, pending, ATLAS_IMAGES_FOLDER);
}

/** Find `entryId` in the named tier, or null. A read: nothing is provisioned. */
export async function resolveAtlasEntryHome(
  repos: RepositoryContainer,
  userId: string,
  scope: AtlasLocation['scope'],
  containerId: string | null | undefined,
  entryId: string,
): Promise<AtlasEntryHome | null> {
  const location = await resolveAtlasLocation(scope, containerId, repos, userId);
  if (!location) return null;
  const record = await location.findEntry(entryId);
  return record ? { location, record, item: record } : null;
}
