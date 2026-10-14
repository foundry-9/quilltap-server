/**
 * Update Wardrobe Item Tool Handler
 *
 * Edits the stored fields of an existing wardrobe item. Resolves the target
 * across every tier to LOCATE it, then enforces own-items-only:
 * shared archetypes (project / Quilltap General; `characterId === null`) are
 * read-only and the edit is refused. Only the supplied fields change. A
 * composite's `types` go through `updateItem`'s widen-never-narrow rule: the
 * components' slots plus every slot it already designated, unless `types` is
 * restated (bug 195).
 *
 * Does NOT equip — wearing is a separate `wardrobe_wear` call. Echoes back the
 * updated item in `wardrobe_read` shape.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeUpdateToolInput, WardrobeUpdateToolOutput } from '../wardrobe-update-tool';
import { validateWardrobeUpdateInput } from '../wardrobe-update-tool';
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { updateItem } from '@/lib/wardrobe/item-mutations';
import { resolveWardrobeLocation } from '@/lib/wardrobe/location';
import { findInPool } from '@/lib/wardrobe/wear-ops';
import {
  loadToolPool,
  normalizeNoItemSentinel,
  sharedWardrobeItemReadOnlyMessage,
  wardrobeItemNotFoundMessage,
  type WardrobeToolContext,
} from './wardrobe-handler-shared';
import { buildWardrobeReadFailure, buildWardrobeReadOutput } from './wardrobe-read-handler';
import { formatWardrobeToolImageLine, maybeQueueWardrobeToolImage } from '@/lib/wardrobe/tool-image-generation';

/** Whether a patch changes what a picture of the item would show. */
function patchChangesLook(item: WardrobeItem, patch: Partial<WardrobeItem>): boolean {
  if (patch.title !== undefined && patch.title !== item.title) return true;
  if (patch.imagePrompt !== undefined && patch.imagePrompt !== (item.imagePrompt ?? null)) return true;
  if (patch.types !== undefined && patch.types.join(',') !== item.types.join(',')) return true;
  if (
    patch.componentItemIds !== undefined &&
    patch.componentItemIds.join(',') !== (item.componentItemIds ?? []).join(',')
  ) {
    return true;
  }
  return false;
}

/** Every wardrobe tool runs in the same context (see `WardrobeToolContext`). */
export type WardrobeUpdateToolContext = WardrobeToolContext;

export async function executeWardrobeUpdateTool(
  input: unknown,
  context: WardrobeUpdateToolContext,
): Promise<WardrobeUpdateToolOutput> {
  const repos = getRepositories();

  const parsed = validateWardrobeUpdateInput(input);

  if (!parsed) {
    logger.warn('Wardrobe update tool validation failed', {
      context: 'wardrobe-update-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      input,
    });
    return buildWardrobeReadFailure('Invalid input: item_id or item_title is required.');
  }

  try {
    const {
      item_id,
      item_title,
      title,
      description,
      image_prompt,
      appropriateness,
      types,
      is_default,
      replace,
      component_item_ids,
      generate_image,
    } = parsed;

    const pool = await loadToolPool(repos, context.chatId, context.characterId);

    const item = findInPool(pool, {
      itemId: normalizeNoItemSentinel(item_id),
      itemTitle: normalizeNoItemSentinel(item_title),
    });
    if (!item) {
      return buildWardrobeReadFailure(wardrobeItemNotFoundMessage(item_id, item_title));
    }

    if (!pool.owns(item)) {
      return buildWardrobeReadFailure(sharedWardrobeItemReadOnlyMessage(item.title, 'changed'));
    }

    const patch: Partial<WardrobeItem> = {};
    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;
    if (image_prompt !== undefined) patch.imagePrompt = image_prompt;
    if (appropriateness !== undefined) patch.appropriateness = appropriateness;
    if (types !== undefined) patch.types = types as WardrobeItemType[];
    if (is_default !== undefined) patch.isDefault = is_default;
    if (replace !== undefined) patch.replace = replace;
    if (component_item_ids !== undefined) patch.componentItemIds = component_item_ids;

    const location = await resolveWardrobeLocation('character', context.characterId, repos, context.userId);
    const updated = location
      ? await updateItem(location, item, patch, { lookup: pool.byId })
      : null;
    if (!updated) {
      return buildWardrobeReadFailure(`Failed to update wardrobe item "${item.title}"`);
    }

    // An edit redraws by default only when it changes how the item looks.
    const changesLook = patchChangesLook(item, patch);
    const imageGeneration = await maybeQueueWardrobeToolImage(repos, {
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      itemId: updated.id,
      requested: generate_image,
      defaultWhenEnabled: changesLook,
      callerContext: 'wardrobe-update-handler',
    });

    logger.info('Wardrobe update completed', {
      context: 'wardrobe-update-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      itemId: updated.id,
      fields: Object.keys(patch),
      changesLook,
      imageGeneration: imageGeneration?.status,
    });

    const output = await buildWardrobeReadOutput(repos, pool, context.chatId, updated);
    return imageGeneration ? { ...output, image_generation: imageGeneration } : output;
  } catch (error) {
    logger.error('Wardrobe update tool execution failed', {
      context: 'wardrobe-update-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);
    return buildWardrobeReadFailure(
      error instanceof Error ? error.message : 'Unknown error during wardrobe update',
    );
  }
}

/**
 * Format wardrobe update results for inclusion in conversation context
 */
export function formatWardrobeUpdateResults(output: WardrobeUpdateToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }
  const imageLine = formatWardrobeToolImageLine(output.image_generation);
  return imageLine
    ? `Updated "${output.title}" (${output.item_id}).\n${imageLine}`
    : `Updated "${output.title}" (${output.item_id}).`;
}
