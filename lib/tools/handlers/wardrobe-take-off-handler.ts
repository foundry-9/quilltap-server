/**
 * Take Off Wardrobe Items Tool Handler
 *
 * Applies an ordered array of take-off operations in sequence. Per-operation
 * mode maps to the displacement primitive `removeFromSlot`:
 *
 *   - `remove`     → for each slot the item covers (or just `slot` if given),
 *                    `removeFromSlot(slot, item.id)` — other layers stay.
 *   - `clear_slot` → `removeFromSlot(slot)` — empty the named slot entirely.
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
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { removeFromSlot } from '@/lib/wardrobe/outfit-displacement';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';
import { resolveProjectMountPointIdsForChat } from '@/lib/mount-index/tiered-mount-pool';
import {
  buildWardrobeCoverageSummaryFromState,
  describeWardrobeEffect,
  emptyEquippedState,
  loadCurrentWardrobeState,
  normalizeNoItemSentinel,
  recordPendingWardrobeAnnouncement,
  resolveWardrobeItemAcrossTiers,
} from './wardrobe-handler-shared';

export interface WardrobeTakeOffToolContext {
  userId: string;
  chatId: string;
  characterId: string;
  /** Per-turn announcement queue. Forwarded from `ToolExecutionContext`. */
  pendingWardrobeAnnouncements?: Set<string>;
}

class WardrobeTakeOffError extends Error {}

function buildFailureResponse(error: string): WardrobeTakeOffToolOutput {
  return {
    success: false,
    operations: [],
    current_state: emptyEquippedState(),
    coverage_summary: '',
    error,
  };
}

export async function executeWardrobeTakeOffTool(
  input: unknown,
  context: WardrobeTakeOffToolContext,
): Promise<WardrobeTakeOffToolOutput> {
  const repos = getRepositories();

  if (!validateWardrobeTakeOffInput(input)) {
    logger.warn('Wardrobe take off tool validation failed', {
      context: 'wardrobe-take-off-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      input,
    });
    return buildFailureResponse(
      'Invalid input: provide a non-empty "operations" array. mode=remove needs an ' +
        'item_id or item_title; mode=clear_slot needs a slot.',
    );
  }

  const projectMountPointIds = await resolveProjectMountPointIdsForChat(context.chatId);

  const results: WardrobeTakeOffOpResult[] = [];
  let appliedCount = 0;
  let failedError: string | undefined;

  for (const op of (input as WardrobeTakeOffToolInput).operations) {
    const mode = op.mode ?? 'remove';
    const itemId = normalizeNoItemSentinel(op.item_id);
    const itemTitle = normalizeNoItemSentinel(op.item_title);

    try {
      if (mode === 'clear_slot') {
        const slot = op.slot!;
        await removeFromSlot(repos, context.chatId, context.characterId, slot);
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
      const item = await resolveWardrobeItemAcrossTiers(
        repos,
        context.characterId,
        itemId,
        itemTitle,
        projectMountPointIds,
      );
      if (!item) {
        throw new WardrobeTakeOffError(
          `Wardrobe item not found${itemId ? ` with ID "${itemId}"` : ''}${itemTitle ? ` with title "${itemTitle}"` : ''}`,
        );
      }

      // Restrict to one slot if given (and the item covers it), else take it off
      // every slot it occupies.
      const slotsAffected: WardrobeItemType[] = op.slot
        ? [op.slot]
        : (item.types as WardrobeItemType[]);
      for (const slot of slotsAffected) {
        await removeFromSlot(repos, context.chatId, context.characterId, slot, item.id);
      }

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

  if (appliedCount > 0) {
    await triggerAvatarGenerationIfEnabled(repos, {
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      callerContext: 'wardrobe-take-off-handler',
    });
    await recordPendingWardrobeAnnouncement(
      {
        userId: context.userId,
        chatId: context.chatId,
        pendingWardrobeAnnouncements: context.pendingWardrobeAnnouncements,
      },
      { sourceContext: 'wardrobe-take-off-handler', characterId: context.characterId },
    );
  }

  const currentState = await loadCurrentWardrobeState(repos, context.chatId, context.characterId);
  const coverageSummary = await buildWardrobeCoverageSummaryFromState(
    repos,
    context.characterId,
    currentState,
    { projectMountPointIds },
  );

  return {
    success: failedError === undefined,
    operations: results,
    current_state: currentState,
    coverage_summary: coverageSummary,
    ...(failedError ? { error: failedError } : {}),
  };
}

/**
 * Format wardrobe take-off results for inclusion in conversation context
 */
export function formatWardrobeTakeOffResults(output: WardrobeTakeOffToolOutput): string {
  if (!output.success && output.operations.length === 0) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }

  const lines: string[] = [];
  for (const op of output.operations) {
    if (op.error) {
      lines.push(`Failed: ${op.error}`);
    } else if (op.effect_summary) {
      lines.push(op.effect_summary);
    }
  }

  lines.push('');
  lines.push('Current outfit:');
  const state: EquippedSlots = output.current_state;
  for (const slotKey of WARDROBE_SLOT_TYPES) {
    const ids = state[slotKey];
    lines.push(`  ${slotKey}: ${ids.length === 0 ? '(empty)' : ids.join(', ')}`);
  }
  lines.push('');
  lines.push(`Summary: ${output.coverage_summary}`);

  return lines.join('\n');
}
