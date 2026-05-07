/**
 * Change Wardrobe Item Tool Handler (atomic items only)
 *
 * Dispatches on `mode` to the equip primitives in
 * `lib/wardrobe/outfit-displacement.ts`:
 *
 *   - `equip`            → `equipItem(item)`
 *   - `add_to_slot`      → `addToSlot(slot, item)`
 *   - `remove_from_slot` → `removeFromSlot(slot, item_id?)`
 *   - `clear_slot`       → `removeFromSlot(slot)`  (no itemId)
 *
 * Composite items (`componentItemIds` non-empty) are rejected with a pointer
 * to `wardrobe_set_outfit`. For `clear_slot` and item-less
 * `remove_from_slot`, no item is named so the composite check is skipped.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeChangeItemToolInput, WardrobeChangeItemToolOutput } from '../wardrobe-change-item-tool';
import { validateWardrobeChangeItemInput } from '../wardrobe-change-item-tool';
import { EMPTY_EQUIPPED_SLOTS, buildCoverageSummary, WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { equipItem, addToSlot, removeFromSlot } from '@/lib/wardrobe/outfit-displacement';
import { expandComposites } from '@/lib/wardrobe/expand-composites';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';
import { enqueueWardrobeOutfitAnnouncement } from '@/lib/background-jobs/queue-service';

export interface WardrobeChangeItemToolContext {
  userId: string;
  chatId: string;
  characterId: string;
}

const NO_ITEM_SENTINELS = new Set(['none', 'null', '']);

function normalizeNoItemSentinel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return NO_ITEM_SENTINELS.has(value.trim().toLowerCase()) ? undefined : value;
}

export class WardrobeChangeItemError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NOT_FOUND' | 'TYPE_MISMATCH' | 'IS_COMPOSITE',
  ) {
    super(message);
    this.name = 'WardrobeChangeItemError';
  }
}

function emptyState(): EquippedSlots {
  return { top: [], bottom: [], footwear: [], accessories: [] };
}

function buildFailureResponse(input: unknown, error: string): WardrobeChangeItemToolOutput {
  const slot =
    typeof input === 'object' && input !== null && 'slot' in input
      ? ((input as Record<string, unknown>).slot as string) || 'unknown'
      : 'unknown';
  return {
    success: false,
    action: 'removed',
    slot,
    item: null,
    current_state: emptyState(),
    coverage_summary: '',
    error,
  };
}

async function resolveWardrobeItem(
  repos: ReturnType<typeof getRepositories>,
  characterId: string,
  itemId: string | undefined,
  itemTitle: string | undefined,
): Promise<WardrobeItem | null> {
  if (itemId) {
    const found = await repos.wardrobe.findByIdForCharacter(characterId, itemId);
    if (found) return found;
  }

  if (itemTitle) {
    const characterItems = await repos.wardrobe.findByCharacterId(characterId);
    const lower = itemTitle.toLowerCase();
    const found = characterItems.find((i) => i.title.toLowerCase() === lower) ?? null;
    return found;
  }

  return null;
}

/** Reject composites — they belong to wardrobe_set_outfit. */
function assertLeafItem(item: WardrobeItem): void {
  if (item.componentItemIds && item.componentItemIds.length > 0) {
    throw new WardrobeChangeItemError(
      `"${item.title}" is a composite outfit, not a single garment. ` +
        'Use the wardrobe_set_outfit tool with mode="wear" or mode="remove" for composites.',
      'IS_COMPOSITE',
    );
  }
}

export async function executeWardrobeChangeItemTool(
  input: unknown,
  context: WardrobeChangeItemToolContext,
): Promise<WardrobeChangeItemToolOutput> {
  const repos = getRepositories();

  try {
    if (!validateWardrobeChangeItemInput(input)) {
      logger.warn('Wardrobe change item tool validation failed', {
        context: 'wardrobe-change-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        input,
      });
      return buildFailureResponse(
        input,
        'Invalid input: mode is required (equip / add_to_slot / remove_from_slot / clear_slot). ' +
          'add_to_slot/remove_from_slot/clear_slot also require a valid slot. ' +
          'equip and add_to_slot require an item_id or item_title.',
      );
    }

    const { mode } = input;
    const slot = input.slot;
    const item_id = normalizeNoItemSentinel(input.item_id);
    const item_title = normalizeNoItemSentinel(input.item_title);

    if (input.item_id !== item_id || input.item_title !== item_title) {
    }

    let action: 'equipped' | 'removed';
    let summarySlot: string;
    let summaryItem: { item_id: string; title: string } | null = null;

    if (mode === 'equip') {
      const item = await resolveWardrobeItem(repos, context.characterId, item_id, item_title);
      if (!item) {
        throw new WardrobeChangeItemError(
          `Wardrobe item not found${item_id ? ` with ID "${item_id}"` : ''}${item_title ? ` with title "${item_title}"` : ''}`,
          'NOT_FOUND',
        );
      }
      if (item.archivedAt) {
        throw new WardrobeChangeItemError(
          `Item "${item.title}" is archived and cannot be equipped`,
          'VALIDATION_ERROR',
        );
      }
      assertLeafItem(item);

      await equipItem(repos, context.chatId, context.characterId, item);

      logger.info('Wardrobe item equipped (replace)', {
        context: 'wardrobe-change-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        itemId: item.id,
        itemTitle: item.title,
        slotsAffected: item.types,
      });

      action = 'equipped';
      summarySlot = item.types.length === 1 ? item.types[0] : 'inferred';
      summaryItem = { item_id: item.id, title: item.title };
    } else if (mode === 'add_to_slot') {
      if (!slot) {
        throw new WardrobeChangeItemError(
          'add_to_slot requires a slot parameter',
          'VALIDATION_ERROR',
        );
      }
      const item = await resolveWardrobeItem(repos, context.characterId, item_id, item_title);
      if (!item) {
        throw new WardrobeChangeItemError(
          `Wardrobe item not found${item_id ? ` with ID "${item_id}"` : ''}${item_title ? ` with title "${item_title}"` : ''}`,
          'NOT_FOUND',
        );
      }
      if (item.archivedAt) {
        throw new WardrobeChangeItemError(
          `Item "${item.title}" is archived and cannot be added`,
          'VALIDATION_ERROR',
        );
      }
      assertLeafItem(item);
      if (!item.types.includes(slot)) {
        throw new WardrobeChangeItemError(
          `Item "${item.title}" (types: ${item.types.join(', ')}) cannot be added to the "${slot}" slot`,
          'TYPE_MISMATCH',
        );
      }

      await addToSlot(repos, context.chatId, context.characterId, slot, item);

      logger.info('Wardrobe item layered into slot', {
        context: 'wardrobe-change-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        slot,
        itemId: item.id,
        itemTitle: item.title,
      });

      action = 'equipped';
      summarySlot = slot;
      summaryItem = { item_id: item.id, title: item.title };
    } else if (mode === 'remove_from_slot') {
      if (!slot) {
        throw new WardrobeChangeItemError(
          'remove_from_slot requires a slot parameter',
          'VALIDATION_ERROR',
        );
      }

      let item: WardrobeItem | null = null;
      if (item_id || item_title) {
        item = await resolveWardrobeItem(repos, context.characterId, item_id, item_title);
        // For named removal, also reject composites: composites should be
        // taken off via wardrobe_set_outfit so all their slots get cleared
        // together, not just one.
        if (item) assertLeafItem(item);
      }

      await removeFromSlot(
        repos,
        context.chatId,
        context.characterId,
        slot,
        item?.id ?? item_id,
      );

      logger.info('Wardrobe item removed from slot', {
        context: 'wardrobe-change-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        slot,
        targetItemId: item?.id ?? item_id ?? null,
      });

      action = 'removed';
      summarySlot = slot;
      summaryItem = item ? { item_id: item.id, title: item.title } : null;
    } else {
      // mode === 'clear_slot'
      if (!slot) {
        throw new WardrobeChangeItemError(
          'clear_slot requires a slot parameter',
          'VALIDATION_ERROR',
        );
      }

      await removeFromSlot(repos, context.chatId, context.characterId, slot);

      logger.info('Wardrobe slot cleared', {
        context: 'wardrobe-change-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        slot,
      });

      action = 'removed';
      summarySlot = slot;
    }

    const currentState = await loadCurrentState(repos, context);
    const coverageSummary = await buildCoverageSummaryFromState(repos, currentState);

    await triggerAvatarGenerationIfEnabled(repos, {
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      callerContext: 'wardrobe-change-item-handler',
    });

    await scheduleAnnouncement(context, summarySlot);

    return {
      success: true,
      action,
      slot: summarySlot,
      item: summaryItem,
      current_state: currentState,
      coverage_summary: coverageSummary,
    };
  } catch (error) {
    if (error instanceof WardrobeChangeItemError) {
      logger.warn('Wardrobe change item error', {
        context: 'wardrobe-change-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        code: error.code,
        message: error.message,
      });
      return buildFailureResponse(input, error.message);
    }

    logger.error('Wardrobe change item tool execution failed', {
      context: 'wardrobe-change-item-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);

    return buildFailureResponse(
      input,
      error instanceof Error ? error.message : 'Unknown error during wardrobe change',
    );
  }
}

async function scheduleAnnouncement(
  context: WardrobeChangeItemToolContext,
  slot: string,
): Promise<void> {
  try {
    await enqueueWardrobeOutfitAnnouncement(context.userId, {
      chatId: context.chatId,
      characterId: context.characterId,
    });
  } catch (error) {
    logger.warn('Failed to schedule wardrobe outfit announcement', {
      context: 'wardrobe-change-item-handler',
      chatId: context.chatId,
      characterId: context.characterId,
      slot,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadCurrentState(
  repos: ReturnType<typeof getRepositories>,
  context: WardrobeChangeItemToolContext,
): Promise<EquippedSlots> {
  const equippedOutfit = await repos.chats.getEquippedOutfitForCharacter(
    context.chatId,
    context.characterId,
  );
  return equippedOutfit ?? { ...EMPTY_EQUIPPED_SLOTS };
}

async function buildCoverageSummaryFromState(
  repos: ReturnType<typeof getRepositories>,
  slots: EquippedSlots,
): Promise<string> {
  const allIds = new Set<string>();
  for (const slotKey of WARDROBE_SLOT_TYPES) {
    for (const id of slots[slotKey]) allIds.add(id);
  }

  const itemsById = new Map<string, WardrobeItem>();
  if (allIds.size > 0) {
    const fetched = await repos.wardrobe.findByIds(Array.from(allIds));
    for (const item of fetched) itemsById.set(item.id, item);
  }

  const perSlotItems: Record<keyof EquippedSlots, WardrobeItem[]> = {
    top: [],
    bottom: [],
    footwear: [],
    accessories: [],
  };

  for (const slotKey of WARDROBE_SLOT_TYPES) {
    const equippedIds = slots[slotKey];
    if (equippedIds.length === 0) continue;

    const { leafIds } = expandComposites(equippedIds, itemsById);
    const seen = new Set<string>();
    for (const leafId of leafIds) {
      if (seen.has(leafId)) continue;
      const leaf = itemsById.get(leafId);
      if (!leaf) continue;
      if (!leaf.types.includes(slotKey)) continue;
      perSlotItems[slotKey].push(leaf);
      seen.add(leafId);
    }
  }

  return buildCoverageSummary(slots, perSlotItems);
}

/**
 * Format wardrobe change item results for inclusion in conversation context
 */
export function formatWardrobeChangeItemResults(output: WardrobeChangeItemToolOutput): string {
  if (!output.success) {
    return `Wardrobe Change Error: ${output.error || 'Unknown error'}`;
  }

  const lines: string[] = [];

  if (output.action === 'equipped' && output.item) {
    if (output.slot === 'inferred') {
      lines.push(`Equipped "${output.item.title}".`);
    } else {
      lines.push(`Equipped "${output.item.title}" in ${output.slot} slot.`);
    }
  } else if (output.action === 'removed' && output.item) {
    lines.push(`Removed "${output.item.title}" from ${output.slot} slot.`);
  } else {
    lines.push(`Cleared ${output.slot} slot.`);
  }

  lines.push('');
  lines.push('Current outfit:');
  const state = output.current_state;
  for (const slotKey of WARDROBE_SLOT_TYPES) {
    const ids = state[slotKey];
    lines.push(`  ${slotKey}: ${ids.length === 0 ? '(empty)' : ids.join(', ')}`);
  }
  lines.push('');
  lines.push(`Summary: ${output.coverage_summary}`);

  return lines.join('\n');
}
