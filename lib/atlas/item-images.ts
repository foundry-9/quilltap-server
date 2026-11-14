/**
 * Atlas entry pictures — a binding of the item-store kernel's pictures
 * (`createItemImages`, `lib/mount-index/item-family-images.ts`) over
 * `Atlas/images/`.
 *
 * Each picture's bytes are a blob link under `Atlas/images/<entryId>/` in the
 * entry's own tier mount, plus a `files` row (`linkedTo: [entryId]`); the
 * entry file carries only the current pick, `imageFileId`.
 *
 * A picture is for the operator — the editor, the viewer and the chip popup.
 * It is never sent to an image model as a reference (Atlas spec §2). The
 * subject of a generated one is the entry's graphic prompt, else its name;
 * log rows are `ATLAS_ENTRY_IMAGE`, counted as image spend.
 *
 * Server-only.
 *
 * @module lib/atlas/item-images
 */

import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { FileEntry } from '@/lib/schemas/file.types';
import type { AtlasRecord } from '@/lib/schemas/atlas.types';
import type { PendingImageMove } from '@/lib/wardrobe/item-images';
import { resolveAtlasLocation, type AtlasLocation } from '@/lib/atlas/location';
import { ATLAS_IMAGES_FOLDER } from '@/lib/atlas/folders';
import {
  createItemImages,
  ForeignItemImageError,
  type AddItemImageInput,
  type ItemImageGenerationResult,
  type ItemImageHome,
  type ItemImageSummary,
} from '@/lib/mount-index/item-family-images';

export { ATLAS_IMAGES_FOLDER, ForeignItemImageError as ForeignAtlasImageError };
export type AtlasImageSummary = ItemImageSummary;

/** An entry located in its tier; `item` is the same record, as the shared images route reads it. */
export type AtlasEntryHome = ItemImageHome<AtlasRecord, AtlasRecord, AtlasLocation>;
export type AddAtlasEntryImageInput = AddItemImageInput;
export type AtlasEntryImageGenerationResult = ItemImageGenerationResult;

/** What the picture shows: the graphic prompt, else the name. Pure. */
export function atlasImageSubject(entry: Pick<AtlasRecord, 'graphicPrompt' | 'name'>): string {
  return (entry.graphicPrompt?.trim() || entry.name.trim()).replace(/[.!?]+$/, '');
}

/** The entry picture prompt: the thing itself, whole, no person. Pure. */
export function buildAtlasEntryImagePrompt(entry: Pick<AtlasRecord, 'graphicPrompt' | 'name'>): string {
  return `A clear, faithful depiction of ${atlasImageSubject(entry)}. The thing is the subject, shown whole and unobstructed, with no person in the foreground.`;
}

export const atlasEntryImages = createItemImages<AtlasRecord, AtlasRecord, AtlasLocation>({
  kind: 'atlas',
  imagesFolder: ATLAS_IMAGES_FOLDER,
  tags: { images: '[AtlasImages]', generation: '[AtlasEntryImage]' },
  noun: 'Atlas entry',
  idKey: 'entryId',
  describe: (entry) => `Atlas picture of “${entry.name}”`,
  logType: 'ATLAS_ENTRY_IMAGE',
  buildPrompt: buildAtlasEntryImagePrompt,
  noProfileMessage: 'No image profile is configured. Set one in Settings → Images before generating pictures of Atlas entries.',
  errorNames: { noProfile: 'NoAtlasImageProfileError', generation: 'AtlasImageGenerationError' },
  resolveLocation: (scope, containerId, repos, userId) => resolveAtlasLocation(scope, containerId, repos, userId),
  find: (location, entryId) => location.findEntry(entryId),
  resolveItem: async (_repos, _location, record) => record,
});

/** No usable profile (a 400). */
export const NoAtlasImageProfileError = atlasEntryImages.NoProfileError;
/** The provider refused or failed; carries the trail. */
export const AtlasImageGenerationError = atlasEntryImages.GenerationError;

/** The entry's pictures, newest first. */
export const listAtlasEntryImages: (repos: Pick<RepositoryContainer, 'files'>, entryId: string) => Promise<FileEntry[]> =
  atlasEntryImages.list;

/** The entry's pictures, as the gallery shows them. */
export function listAtlasEntryImageSummaries(repos: Pick<RepositoryContainer, 'files'>, entryId: string): Promise<AtlasImageSummary[]> {
  return atlasEntryImages.listShown(repos, { id: entryId } as AtlasRecord);
}

/** Refuse an `imageFileId` that is not one of the entry's own pictures. */
export const assertAtlasImageChoice = atlasEntryImages.assertChoice;
/** Store a new picture for the entry and make it current. */
export const addAtlasEntryImage = atlasEntryImages.add;
/** Make one of the entry's pictures current. */
export const setCurrentAtlasEntryImage = atlasEntryImages.setCurrent;
/** Delete one of the entry's pictures; the next-newest becomes current. */
export const deleteAtlasEntryImage = atlasEntryImages.remove;
/** Drop every picture of a deleted entry. Logs, never throws. */
export const cleanupAtlasEntryImages = atlasEntryImages.cleanup;
/** Carry an entry's pictures to another mount for a transfer. */
export const carryAtlasEntryImages = atlasEntryImages.carry;
/** Finish a move's pictures once the entry has landed. */
export const commitMovedAtlasEntryImages: (
  repos: Pick<RepositoryContainer, 'files'>,
  entryId: string,
  pending: PendingImageMove,
) => Promise<void> = atlasEntryImages.commitMoved;
/** Find `entryId` in the named tier, or null. A read: nothing is provisioned. */
export const resolveAtlasEntryHome = atlasEntryImages.resolveHome;
/** Generate, store and make current a picture of `home.record`. */
export const generateAtlasEntryImage = atlasEntryImages.generate;
