/**
 * The steps every wardrobe item endpoint (character, General, project,
 * group) performs around its write (the archive flag is `updateItem`'s, in
 * `item-mutations.ts`):
 *
 *   - PUT: refuse an `imageFileId` that is not one of the item's own pictures
 *     (`imageChoiceError`);
 *   - DELETE: scrub equipped references to the item from every chat, and drop
 *     its wear-ledger rows, before the row/file goes — logging (never failing)
 *     when either clean-up hiccups — and drop its pictures once it is gone
 *     (`cleanupItemImages`, re-exported here).
 *
 * Server-only (logs through the app logger).
 *
 * @module lib/wardrobe/item-route-steps
 */

import { logger } from '@/lib/logger';
import {
  ForeignWardrobeImageError,
  assertItemImageChoice,
  cleanupItemImages,
} from '@/lib/wardrobe/item-images';

export { cleanupItemImages };

/**
 * The 400 message for a PUT whose `imageFileId` names a file that is not one
 * of the item's own pictures, or null when the choice is fine (or absent).
 */
export async function imageChoiceError(
  repos: Parameters<typeof assertItemImageChoice>[0],
  itemId: string,
  imageFileId: string | null | undefined,
): Promise<string | null> {
  try {
    await assertItemImageChoice(repos, itemId, imageFileId);
    return null;
  } catch (error) {
    if (error instanceof ForeignWardrobeImageError) {
      logger.info('[WardrobeItem] Refused an imageFileId that is not the item\'s own', { itemId, imageFileId });
      return 'imageFileId must name one of this item\'s own pictures';
    }
    throw error;
  }
}

/**
 * Remove `itemId` from every chat's equipped slots, and drop its wear-ledger
 * rows (`wardrobe_wear_stats`), ahead of deleting it.
 * Composite items that still reference the id in `componentItemIds` are left
 * alone on purpose: `expandComposites` tolerates unknown ids. Likewise a
 * composite's deletion drops only its own ledger rows, never its components'.
 * A failure in either step is logged under `logTag` with `meta` and the delete
 * proceeds regardless.
 */
export async function cleanupEquippedRefs(
  repos: {
    chats: { removeEquippedItemFromAllChats(itemId: string): Promise<unknown> };
    wardrobeWear: { deleteByItemIds(itemIds: string[]): Promise<unknown> };
  },
  itemId: string,
  logTag: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await repos.chats.removeEquippedItemFromAllChats(itemId);
  } catch (cleanupError) {
    logger.warn(`${logTag} Cleanup of equipped references had issues, proceeding with delete`, {
      ...meta,
      cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    });
  }

  try {
    await repos.wardrobeWear.deleteByItemIds([itemId]);
    logger.debug(`${logTag} Dropped wear-ledger rows for deleted item`, { ...meta, itemId });
  } catch (ledgerError) {
    logger.warn(`${logTag} Cleanup of wear-ledger rows had issues, proceeding with delete`, {
      ...meta,
      ledgerError: ledgerError instanceof Error ? ledgerError.message : String(ledgerError),
    });
  }
}
