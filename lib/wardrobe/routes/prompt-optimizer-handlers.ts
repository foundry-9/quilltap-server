/**
 * Route bodies for the wardrobe's image-prompt optimizer, on every tier
 * (character, group, project, Quilltap General):
 *
 *   POST <tier>/wardrobe?action=optimize-image-prompts
 *     — review that tier's own garments with the cheap LLM and return
 *       recommendations. Writes nothing.
 *   POST <tier>/wardrobe?action=apply-image-prompts
 *     — write the chosen recommendations (`updateItemImagePrompts`).
 *
 * Wired by `wardrobe-route-factory.ts`. A review reads only the tier it was
 * called on — never the pieces another tier shares into it.
 *
 * @module lib/wardrobe/routes/prompt-optimizer-handlers
 */

import type { RequestContext } from '@/lib/api/middleware/context';
import { badRequest, successResponse } from '@/lib/api/responses';
import { resolveCheapLLMSelectionForUser } from '@/lib/llm/cheap-llm-user-selection';
import { logger } from '@/lib/logger';
import {
  applyWardrobeImagePromptsSchema,
  optimizeWardrobeImagePromptsSchema,
} from '@/lib/schemas/wardrobe.types';
import { updateItemImagePrompts } from '@/lib/wardrobe/item-mutations';
import type { WardrobeLocation } from '@/lib/wardrobe/location';
import { optimizeWardrobeImagePrompts } from '@/lib/wardrobe/prompt-optimizer';

const NO_CHEAP_LLM_MESSAGE =
  'No connection profile is configured to run the review. Add one in your provider settings.';

/** Review one tier's garments; `location` is that tier (or null when it has no store yet). */
export async function handleOptimizeImagePrompts(
  body: unknown,
  ctx: RequestContext,
  location: WardrobeLocation | null,
) {
  const { itemIds } = optimizeWardrobeImagePromptsSchema.parse(body ?? {});
  if (!location) return successResponse({ examined: 0, recommendations: [], failedItemIds: [] });

  const wanted = itemIds ? new Set(itemIds) : null;
  // Archived pieces are left out by the read; composites by the optimizer.
  const items = (await location.readItems(false)).filter((item) => !wanted || wanted.has(item.id));

  const chatSettings = await ctx.repos.chatSettings.findByUserId(ctx.user.id);
  const resolved = await resolveCheapLLMSelectionForUser(ctx.repos, ctx.user.id, chatSettings);
  if (!resolved) return badRequest(NO_CHEAP_LLM_MESSAGE);

  logger.debug('[Wardrobe v1] Optimizing image prompts', {
    scope: location.scope,
    ownerId: location.id,
    candidates: items.length,
    provider: resolved.selection.provider,
    model: resolved.selection.modelName,
    context: 'wardrobe',
  });

  const result = await optimizeWardrobeImagePrompts({
    items,
    selection: resolved.selection,
    userId: ctx.user.id,
    // Only a character's review is filed against the character in the LLM logs.
    characterId: location.scope === 'character' ? (location.id ?? undefined) : undefined,
  });
  return successResponse({
    ...result,
    provider: resolved.selection.provider,
    model: resolved.selection.modelName,
  });
}

/** Write the chosen recommendations; errors are the caller's to map. */
export async function handleApplyImagePrompts(
  body: unknown,
  ctx: RequestContext,
  location: WardrobeLocation,
) {
  const { changes } = applyWardrobeImagePromptsSchema.parse(body);
  const updated = await updateItemImagePrompts(location, changes);
  logger.info('[Wardrobe v1] Applied optimized image prompts', {
    scope: location.scope,
    ownerId: location.id,
    userId: ctx.user.id,
    mountPointId: location.mountPointId,
    requested: changes.length,
    written: updated.length,
    context: 'wardrobe',
  });
  return successResponse({ updated: updated.length, itemIds: updated.map((item) => item.id) });
}
