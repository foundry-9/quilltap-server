/**
 * Wardrobe pictures for a character's Aurora gallery — every generated image
 * of every wardrobe item the character can reach.
 *
 * "Can reach" is the character's wearable pool (`loadWearablePool`): their own
 * vault, the stores of every group they belong to, and Quilltap General. There
 * is no chat here, so the project tier — which is a property of a chat, not a
 * character — is not part of it. Archived items are included (their pictures
 * still exist) and flagged, and a shadowed copy is reported from the tier
 * that wins, as everywhere else.
 *
 * A picture is a `files` row linked to its item (see `item-images.ts`); this
 * module reads them all in one bulk lookup and keeps the GENERATED ones.
 * Read-only: managing an item's pictures stays with the item editor.
 *
 * Server-only.
 *
 * @module lib/wardrobe/gallery-images
 */

import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { loadWearablePool } from '@/lib/wardrobe/pool';
import { wardrobeImageThumbnailUrl, wardrobeImageUrl } from '@/lib/wardrobe/item-images';
import {
  wardrobeOriginLabel,
  type WardrobeContainerScope,
} from '@/lib/wardrobe/wardrobe-container';

const LOG_CONTEXT = 'wardrobe.gallery-images';

/** One wardrobe picture, as the gallery renders it. */
export interface WardrobeGalleryImageEntry {
  fileId: string;
  fileName: string;
  url: string;
  thumbnailUrl: string;
  mimeType: string | null;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  generationPrompt: string | null;
  generationModel: string | null;
  itemId: string;
  itemTitle: string;
  /** Which tier the item lives in. */
  scope: WardrobeContainerScope;
  /** Display text for the item's tier: "Own wardrobe", "Group · X", "Shared · Quilltap General". */
  locationLabel: string;
  itemArchived: boolean;
  /** True when this is the item's chosen picture (`imageFileId`). */
  isCurrentItemImage: boolean;
}

export interface ListWardrobeGalleryImagesOutput {
  entries: WardrobeGalleryImageEntry[];
  total: number;
}

export const OWN_WARDROBE_LABEL = 'Own wardrobe';

export async function listWardrobeGalleryImages(
  repos: Pick<RepositoryContainer, 'characters' | 'wardrobe' | 'projects' | 'chats' | 'files'>,
  characterId: string,
): Promise<ListWardrobeGalleryImagesOutput> {
  const character = await repos.characters.findById(characterId);
  if (!character) {
    throw new Error(`Character not found: ${characterId}`);
  }
  if (character.archivedAt) {
    // A tombstone's vault may be pruned; there is nothing to show and no
    // reason to go looking.
    logger.debug('[WardrobeGallery] Archived character — no wardrobe pictures', {
      context: LOG_CONTEXT,
      characterId,
    });
    return { entries: [], total: 0 };
  }

  // No chat, so no project tier: pass it explicitly empty.
  const pool = await loadWearablePool(repos, characterId, []);
  const items = Array.from(pool.byId.values());
  if (items.length === 0) return { entries: [], total: 0 };

  const itemsById = new Map(items.map((item) => [item.id, item]));
  const files = await repos.files.findByLinkedToAny(items.map((item) => item.id));

  const entries: WardrobeGalleryImageEntry[] = [];
  for (const file of files) {
    if (file.category !== 'IMAGE' || file.source !== 'GENERATED') continue;
    const item = file.linkedTo.map((id) => itemsById.get(id)).find(Boolean);
    if (!item) continue;
    entries.push({
      fileId: file.id,
      fileName: file.originalFilename,
      url: wardrobeImageUrl(file.id),
      thumbnailUrl: wardrobeImageThumbnailUrl(file.id),
      mimeType: file.mimeType ?? null,
      fileSizeBytes: file.size,
      width: file.width ?? null,
      height: file.height ?? null,
      createdAt: String(file.createdAt),
      generationPrompt: file.generationPrompt ?? null,
      generationModel: file.generationModel ?? null,
      itemId: item.id,
      itemTitle: item.title,
      scope: item.origin.scope,
      locationLabel: wardrobeOriginLabel(item.origin) ?? OWN_WARDROBE_LABEL,
      itemArchived: !!item.archivedAt,
      isCurrentItemImage: item.imageFileId === file.id,
    });
  }

  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  logger.debug('[WardrobeGallery] Listed wardrobe pictures', {
    context: LOG_CONTEXT,
    characterId,
    itemCount: items.length,
    linkedFileCount: files.length,
    returned: entries.length,
  });

  return { entries, total: entries.length };
}
