/**
 * Update Outfit Item Tool Handler
 *
 * Equips or removes wardrobe items from outfit slots.
 * Validates that items exist and have the correct type for the slot.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeUpdateOutfitToolInput, WardrobeUpdateOutfitToolOutput } from '../wardrobe-update-outfit-tool';
import { validateWardrobeUpdateOutfitInput } from '../wardrobe-update-outfit-tool';
import { EMPTY_EQUIPPED_SLOTS, buildCoverageSummary, WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { equipWithDisplacement, unequipWithDisplacement } from '@/lib/wardrobe/outfit-displacement';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';

export interface WardrobeUpdateOutfitToolContext {
  userId: string;
  chatId: string;
  characterId: string;
}

export class WardrobeUpdateOutfitError extends Error {
  constructor(message: string, public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NOT_FOUND' | 'TYPE_MISMATCH') {
    super(message);
    this.name = 'WardrobeUpdateOutfitError';
  }
}

/**
 * Execute the update_outfit_item tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID, chat ID, and character ID
 * @returns Tool output with operation result
 */
export async function executeWardrobeUpdateOutfitTool(
  input: unknown,
  context: WardrobeUpdateOutfitToolContext
): Promise<WardrobeUpdateOutfitToolOutput> {
  const repos = getRepositories();

  try {
    // Validate input
    if (!validateWardrobeUpdateOutfitInput(input)) {
      logger.warn('Wardrobe update outfit tool validation failed', {
        context: 'wardrobe-update-outfit-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        input,
      });
      return {
        success: false,
        action: 'removed',
        slot: typeof input === 'object' && input !== null && 'slot' in input
          ? (input as Record<string, unknown>).slot as string
          : 'unknown',
        item: null,
        current_state: { ...EMPTY_EQUIPPED_SLOTS },
        coverage_summary: '',
        error: 'Invalid input: slot is required and must be "top", "bottom", "footwear", or "accessories"',
      };
    }

    const { slot, item_id, item_title, preset_id } = input;

    // --- Preset application flow ---
    if (preset_id) {
      const preset = await repos.outfitPresets.findById(preset_id);
      if (!preset) {
        logger.warn('Outfit preset not found', {
          context: 'wardrobe-update-outfit-handler',
          userId: context.userId,
          chatId: context.chatId,
          characterId: context.characterId,
          presetId: preset_id,
        });
        throw new WardrobeUpdateOutfitError(
          `Outfit preset not found with ID "${preset_id}"`,
          'NOT_FOUND'
        );
      }

      // Validate preset belongs to this character (or is shared)
      if (preset.characterId !== null && preset.characterId !== undefined && preset.characterId !== context.characterId) {
        logger.warn('Outfit preset does not belong to character', {
          context: 'wardrobe-update-outfit-handler',
          userId: context.userId,
          characterId: context.characterId,
          presetCharacterId: preset.characterId,
          presetId: preset.id,
        });
        throw new WardrobeUpdateOutfitError(
          `Preset "${preset.name}" does not belong to this character`,
          'NOT_FOUND'
        );
      }

      // Check that none of the preset's items are archived
      for (const slotKey of WARDROBE_SLOT_TYPES) {
        const itemId = preset.slots[slotKey];
        if (itemId) {
          const item = await repos.wardrobe.findById(itemId);
          if (item?.archivedAt) {
            logger.warn('Preset references archived wardrobe item', {
              context: 'wardrobe-update-outfit-handler',
              userId: context.userId,
              characterId: context.characterId,
              presetId: preset.id,
              slot: slotKey,
              itemId,
              itemTitle: item.title,
            });
            throw new WardrobeUpdateOutfitError(
              `Cannot apply preset "${preset.name}": item "${item.title}" in ${slotKey} slot is archived`,
              'VALIDATION_ERROR'
            );
          }
        }
      }

      // Apply each non-null slot from the preset with displacement
      for (const slotKey of WARDROBE_SLOT_TYPES) {
        const itemId = preset.slots[slotKey];
        if (itemId !== null && itemId !== undefined) {
          const presetItem = await repos.wardrobe.findById(itemId);
          if (presetItem) {
            await equipWithDisplacement(repos, context.chatId, context.characterId, presetItem);
          } else {
            await repos.chats.updateEquippedSlot(context.chatId, context.characterId, slotKey, itemId);
          }
          logger.debug('Applied preset slot', {
            context: 'wardrobe-update-outfit-handler',
            chatId: context.chatId,
            characterId: context.characterId,
            slot: slotKey,
            itemId,
            presetId: preset.id,
          });
        }
      }

      logger.info('Outfit preset applied', {
        context: 'wardrobe-update-outfit-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        presetId: preset.id,
        presetName: preset.name,
      });

      // Load full current state after preset application
      const currentState = await loadCurrentState(repos, context);
      const coverageSummary = await buildCoverageSummaryFromState(repos, currentState);

      // Trigger avatar generation if enabled
      await triggerAvatarGenerationIfEnabled(repos, {
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        callerContext: 'wardrobe-update-outfit-handler',
      });

      return {
        success: true,
        action: 'equipped',
        slot: 'preset',
        item: null,
        current_state: currentState,
        coverage_summary: coverageSummary,
      };
    }

    const isEquipAction = item_id !== undefined || item_title !== undefined;

    if (isEquipAction) {
      // --- Equip action ---
      let item: WardrobeItem | null = null;

      // Look up item by ID first
      if (item_id) {
        item = await repos.wardrobe.findById(item_id);
        logger.debug('Wardrobe item lookup by ID', {
          context: 'wardrobe-update-outfit-handler',
          itemId: item_id,
          found: !!item,
        });
      }

      // Fall back to title search if no ID or ID not found
      if (!item && item_title) {
        const characterItems = await repos.wardrobe.findByCharacterId(context.characterId);
        item = characterItems.find(
          (i) => i.title.toLowerCase() === item_title.toLowerCase()
        ) || null;
        logger.debug('Wardrobe item lookup by title', {
          context: 'wardrobe-update-outfit-handler',
          characterId: context.characterId,
          itemTitle: item_title,
          found: !!item,
          candidateCount: characterItems.length,
        });
      }

      // Validate item exists
      if (!item) {
        logger.warn('Wardrobe item not found', {
          context: 'wardrobe-update-outfit-handler',
          userId: context.userId,
          chatId: context.chatId,
          characterId: context.characterId,
          itemId: item_id,
          itemTitle: item_title,
        });
        throw new WardrobeUpdateOutfitError(
          `Wardrobe item not found${item_id ? ` with ID "${item_id}"` : ''}${item_title ? ` with title "${item_title}"` : ''}`,
          'NOT_FOUND'
        );
      }

      // Validate item belongs to this character (or is an archetype with null characterId)
      if (item.characterId != null && item.characterId !== context.characterId) {
        logger.warn('Wardrobe item does not belong to character', {
          context: 'wardrobe-update-outfit-handler',
          userId: context.userId,
          characterId: context.characterId,
          itemCharacterId: item.characterId,
          itemId: item.id,
        });
        throw new WardrobeUpdateOutfitError(
          `Item "${item.title}" does not belong to this character`,
          'NOT_FOUND'
        );
      }

      // Validate item is not archived
      if (item.archivedAt) {
        logger.warn('Attempted to equip archived wardrobe item', {
          context: 'wardrobe-update-outfit-handler',
          userId: context.userId,
          characterId: context.characterId,
          itemId: item.id,
          itemTitle: item.title,
          archivedAt: item.archivedAt,
        });
        throw new WardrobeUpdateOutfitError(
          `Item "${item.title}" is archived and cannot be equipped`,
          'VALIDATION_ERROR'
        );
      }

      // Validate the item's types include the requested slot
      if (!item.types.includes(slot as WardrobeItem['types'][number])) {
        logger.warn('Wardrobe item type mismatch for slot', {
          context: 'wardrobe-update-outfit-handler',
          userId: context.userId,
          characterId: context.characterId,
          itemId: item.id,
          itemTypes: item.types,
          requestedSlot: slot,
        });
        throw new WardrobeUpdateOutfitError(
          `Item "${item.title}" (types: ${item.types.join(', ')}) cannot be equipped in the "${slot}" slot`,
          'TYPE_MISMATCH'
        );
      }

      // Equip the item in all matching slots with displacement of conflicting items
      await equipWithDisplacement(repos, context.chatId, context.characterId, item);

      logger.info('Wardrobe item equipped', {
        context: 'wardrobe-update-outfit-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        slot,
        itemId: item.id,
        itemTitle: item.title,
        slotsAffected: item.types,
      });

      // Load full current state after update
      const currentState = await loadCurrentState(repos, context);
      const coverageSummary = await buildCoverageSummaryFromState(repos, currentState);

      // Trigger avatar generation if enabled
      await triggerAvatarGenerationIfEnabled(repos, {
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        callerContext: 'wardrobe-update-outfit-handler',
      });

      return {
        success: true,
        action: 'equipped',
        slot,
        item: { item_id: item.id, title: item.title },
        current_state: currentState,
        coverage_summary: coverageSummary,
      };
    } else {
      // --- Remove action --- clear all slots covered by the item in this slot
      await unequipWithDisplacement(repos, context.chatId, context.characterId, slot as WardrobeItemType);

      logger.info('Wardrobe slot cleared (with displacement)', {
        context: 'wardrobe-update-outfit-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        slot,
      });

      // Load full current state after update
      const currentState = await loadCurrentState(repos, context);
      const coverageSummary = await buildCoverageSummaryFromState(repos, currentState);

      // Trigger avatar generation if enabled
      await triggerAvatarGenerationIfEnabled(repos, {
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        callerContext: 'wardrobe-update-outfit-handler',
      });

      return {
        success: true,
        action: 'removed',
        slot,
        item: null,
        current_state: currentState,
        coverage_summary: coverageSummary,
      };
    }
  } catch (error) {
    if (error instanceof WardrobeUpdateOutfitError) {
      return {
        success: false,
        action: 'removed',
        slot: typeof input === 'object' && input !== null && 'slot' in input
          ? (input as Record<string, unknown>).slot as string
          : 'unknown',
        item: null,
        current_state: { ...EMPTY_EQUIPPED_SLOTS },
        coverage_summary: '',
        error: error.message,
      };
    }

    logger.error('Wardrobe update outfit tool execution failed', {
      context: 'wardrobe-update-outfit-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      action: 'removed',
      slot: typeof input === 'object' && input !== null && 'slot' in input
        ? (input as Record<string, unknown>).slot as string
        : 'unknown',
      item: null,
      current_state: { ...EMPTY_EQUIPPED_SLOTS },
      coverage_summary: '',
      error: error instanceof Error ? error.message : 'Unknown error during outfit update',
    };
  }
}

/**
 * Load the current equipped outfit state for a character in a chat
 */
async function loadCurrentState(
  repos: ReturnType<typeof getRepositories>,
  context: WardrobeUpdateOutfitToolContext
): Promise<EquippedSlots> {
  const equippedOutfit = await repos.chats.getEquippedOutfitForCharacter(
    context.chatId,
    context.characterId
  );
  return equippedOutfit || { ...EMPTY_EQUIPPED_SLOTS };
}

/**
 * Build a coverage summary by resolving item IDs to their wardrobe item details
 */
async function buildCoverageSummaryFromState(
  repos: ReturnType<typeof getRepositories>,
  slots: EquippedSlots
): Promise<string> {
  const items: Record<string, WardrobeItem | null> = {
    top: null,
    bottom: null,
    footwear: null,
    accessories: null,
  };

  for (const slotKey of ['top', 'bottom', 'footwear', 'accessories'] as const) {
    const itemId = slots[slotKey];
    if (itemId) {
      items[slotKey] = await repos.wardrobe.findById(itemId);
    }
  }

  return buildCoverageSummary(slots, items);
}

/**
 * Format wardrobe update outfit results for inclusion in conversation context
 *
 * @param output - Wardrobe update outfit tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatWardrobeUpdateOutfitResults(output: WardrobeUpdateOutfitToolOutput): string {
  if (!output.success) {
    return `Outfit Update Error: ${output.error || 'Unknown error'}`;
  }

  const lines: string[] = [];

  if (output.action === 'equipped' && output.item) {
    lines.push(`Equipped "${output.item.title}" in ${output.slot} slot.`);
  } else {
    lines.push(`Removed item from ${output.slot} slot.`);
  }

  // Show current outfit state
  lines.push('');
  lines.push('Current outfit:');
  const state = output.current_state;
  lines.push(`  Top: ${state.top || '(empty)'}`);
  lines.push(`  Bottom: ${state.bottom || '(empty)'}`);
  lines.push(`  Footwear: ${state.footwear || '(empty)'}`);
  lines.push(`  Accessories: ${state.accessories || '(empty)'}`);
  lines.push('');
  lines.push(`Summary: ${output.coverage_summary}`);

  return lines.join('\n');
}
