/**
 * Take Off Wardrobe Items Tool Handler
 *
 * Applies an ordered array of take-off operations in sequence, through
 * `applyDisplacement` (`lib/wardrobe/outfit-displacement.ts`):
 *
 *   - `remove`     → for each slot the item covers (or just `slot` if given),
 *                    take the item out of that slot (`takeOffItem`) — other
 *                    layers stay.
 *   - `clear_slot` → empty the named slot entirely.
 *
 * Works for single garments and composites (a composite's id is filtered out of
 * every slot it covers). Fails fast on the first bad operation; fires avatar
 * generation + the Aurora announcement ONCE after the loop.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  WardrobeTakeOffToolInput,
  WardrobeTakeOffToolOutput,
  WardrobeTakeOffOpResult,
} from '../wardrobe-take-off-tool';
import { validateWardrobeTakeOffInput } from '../wardrobe-take-off-tool';
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { applyDisplacement } from '@/lib/wardrobe/outfit-displacement';
import { findInPool, takeOffItem } from '@/lib/wardrobe/wear-ops';
import {
  buildWardrobeMutationFailure,
  describeWardrobeEffect,
  finalizeWardrobeMutation,
  formatWardrobeMutationResults,
  loadToolPool,
  normalizeNoItemSentinel,
  wardrobeItemNotFoundMessage,
  type WardrobeToolContext,
} from './wardrobe-handler-shared';

/** Every wardrobe tool runs in the same context (see `WardrobeToolContext`). */
export type WardrobeTakeOffToolContext = WardrobeToolContext;

class WardrobeTakeOffError extends Error {}

export async function executeWardrobeTakeOffTool(
  input: unknown,
  context: WardrobeTakeOffToolContext,
): Promise<WardrobeTakeOffToolOutput> {
  const repos = getRepositories();

  const parsed = validateWardrobeTakeOffInput(input);

  if (!parsed) {
    logger.warn('Wardrobe take off tool validation failed', {
      context: 'wardrobe-take-off-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      input,
    });
    return buildWardrobeMutationFailure(
      'Invalid input: provide a non-empty "operations" array. mode=remove needs an ' +
        'item_id or item_title; mode=clear_slot needs a slot.',
    );
  }

  const pool = await loadToolPool(repos, context.chatId, context.characterId);

  const results: WardrobeTakeOffOpResult[] = [];
  let appliedCount = 0;
  let failedError: string | undefined;

  for (const op of parsed.operations) {
    const mode = op.mode ?? 'remove';
    const itemId = normalizeNoItemSentinel(op.item_id);
    const itemTitle = normalizeNoItemSentinel(op.item_title);

    try {
      if (mode === 'clear_slot') {
        const slot = op.slot!;
        await applyDisplacement(repos, context.chatId, context.characterId, { mode: 'clear_slot', slot });
        results.push({
          mode,
          effect: 'cleared',
          effect_summary: describeWardrobeEffect('cleared', [slot]),
          item: null,
          slots_affected: [slot],
        });
        appliedCount++;
        logger.info('Wardrobe slot cleared', {
          context: 'wardrobe-take-off-handler',
          userId: context.userId,
          chatId: context.chatId,
          characterId: context.characterId,
          slot,
        });
        continue;
      }

      // mode === 'remove'
      const item = findInPool(pool, { itemId, itemTitle });
      if (!item) {
        throw new WardrobeTakeOffError(wardrobeItemNotFoundMessage(itemId, itemTitle));
      }

      // Restrict to one slot if given (and the item covers it), else take it off
      // every slot it occupies.
      const slotsAffected: WardrobeItemType[] = op.slot
        ? [op.slot]
        : (item.types as WardrobeItemType[]);
      await takeOffItem(repos, context.chatId, context.characterId, item.id, slotsAffected);

      results.push({
        mode,
        effect: 'removed',
        effect_summary: describeWardrobeEffect('removed', slotsAffected, item.title),
        item: { item_id: item.id, title: item.title },
        slots_affected: slotsAffected,
      });
      appliedCount++;
      logger.info('Wardrobe item taken off', {
        context: 'wardrobe-take-off-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        itemId: item.id,
        itemTitle: item.title,
        slotsAffected,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error taking item off';
      results.push({
        mode,
        effect: 'removed',
        effect_summary: '',
        item: null,
        slots_affected: [],
        error: message,
      });
      failedError = message;
      logger.warn('Wardrobe take off operation failed', {
        context: 'wardrobe-take-off-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        mode,
        message,
      });
      break; // fail-fast
    }
  }

  return finalizeWardrobeMutation(repos, context, 'wardrobe-take-off-handler', {
    appliedCount,
    results,
    failedError,
    pool,
  });
}

/**
 * Format wardrobe take-off results for inclusion in conversation context
 */
export function formatWardrobeTakeOffResults(output: WardrobeTakeOffToolOutput): string {
  return formatWardrobeMutationResults(output);
}
