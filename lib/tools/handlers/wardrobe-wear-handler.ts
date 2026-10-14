/**
 * Wear Wardrobe Items Tool Handler
 *
 * Applies an ordered array of put-on operations in sequence, each building on
 * the last (equipped state is loaded/mutated/persisted per primitive, so it
 * accumulates naturally). Each operation goes through `lib/wardrobe/wear-ops.ts`
 * — the same resolution and gestures the chat's `?action=equip` uses:
 *
 *   - `wear`        — honours the item's replace flag
 *   - `replace`     — force-swaps the covered slots
 *   - `add_to_slot` — layers into one named slot
 *
 * Single garments and composites are handled identically — the item's own
 * `replace` flag decides layer-vs-swap. The handler FAILS FAST on the first bad
 * operation (item not found / archived / slot mismatch), returning the partial
 * results plus the resulting state. Avatar generation and the Aurora
 * announcement fire ONCE after the loop.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  WardrobeWearToolInput,
  WardrobeWearToolOutput,
  WardrobeWearOpResult,
} from '../wardrobe-wear-tool';
import { validateWardrobeWearInput } from '../wardrobe-wear-tool';
import { resolveWearable, wearItem } from '@/lib/wardrobe/wear-ops';
import {
  buildWardrobeMutationFailure,
  describeWardrobeEffect,
  finalizeWardrobeMutation,
  formatWardrobeMutationResults,
  loadToolPool,
  normalizeNoItemSentinel,
  type WardrobeToolContext,
} from './wardrobe-handler-shared';

/** Every wardrobe tool runs in the same context (see `WardrobeToolContext`). */
export type WardrobeWearToolContext = WardrobeToolContext;

class WardrobeWearError extends Error {}

export async function executeWardrobeWearTool(
  input: unknown,
  context: WardrobeWearToolContext,
): Promise<WardrobeWearToolOutput> {
  const repos = getRepositories();

  const parsed = validateWardrobeWearInput(input);

  if (!parsed) {
    logger.warn('Wardrobe wear tool validation failed', {
      context: 'wardrobe-wear-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      input,
    });
    return buildWardrobeMutationFailure(
      'Invalid input: provide a non-empty "operations" array. Each operation needs ' +
        'an item_id or item_title; mode=add_to_slot also needs a slot.',
    );
  }

  const pool = await loadToolPool(repos, context.chatId, context.characterId);

  const results: WardrobeWearOpResult[] = [];
  let appliedCount = 0;
  let failedError: string | undefined;

  for (const op of parsed.operations) {
    const mode = op.mode ?? 'wear';
    const itemId = normalizeNoItemSentinel(op.item_id);
    const itemTitle = normalizeNoItemSentinel(op.item_title);

    try {
      const resolved = resolveWearable(pool, { itemId, itemTitle }, mode, op.slot);
      if (!resolved.ok) {
        throw new WardrobeWearError(resolved.message);
      }
      const { item } = resolved;
      const { effect, slotsAffected } = await wearItem(
        repos,
        context.chatId,
        pool,
        item,
        mode,
        op.slot,
        'tool',
      );

      results.push({
        mode,
        effect,
        effect_summary: describeWardrobeEffect(effect, slotsAffected, item.title),
        item: { item_id: item.id, title: item.title },
        slots_affected: slotsAffected,
      });
      appliedCount++;

      logger.info('Wardrobe item worn', {
        context: 'wardrobe-wear-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        itemId: item.id,
        itemTitle: item.title,
        mode,
        effect,
        slotsAffected,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error wearing item';
      results.push({
        mode,
        effect: 'layered',
        effect_summary: '',
        item: null,
        slots_affected: [],
        error: message,
      });
      failedError = message;
      logger.warn('Wardrobe wear operation failed', {
        context: 'wardrobe-wear-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        mode,
        message,
      });
      break; // fail-fast
    }
  }

  return finalizeWardrobeMutation(repos, context, 'wardrobe-wear-handler', {
    appliedCount,
    results,
    failedError,
    pool,
  });
}

/**
 * Format wardrobe wear results for inclusion in conversation context
 */
export function formatWardrobeWearResults(output: WardrobeWearToolOutput): string {
  return formatWardrobeMutationResults(output);
}
