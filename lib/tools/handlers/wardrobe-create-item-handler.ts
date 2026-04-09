/**
 * Create Wardrobe Item Tool Handler
 *
 * Creates new wardrobe items and optionally equips them immediately.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeCreateItemToolInput, WardrobeCreateItemToolOutput } from '../wardrobe-create-item-tool';
import { validateWardrobeCreateItemInput } from '../wardrobe-create-item-tool';
import type { WardrobeItemType, EquippedSlots } from '@/lib/schemas/wardrobe.types';
import { WARDROBE_SLOT_TYPES, EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types';
import { equipWithDisplacement } from '@/lib/wardrobe/outfit-displacement';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';

export interface WardrobeCreateItemToolContext {
  userId: string;
  chatId: string;
  characterId: string;
}

export class WardrobeCreateItemError extends Error {
  constructor(message: string, public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR') {
    super(message);
    this.name = 'WardrobeCreateItemError';
  }
}

/**
 * Execute the create wardrobe item tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID, chat ID, and character ID
 * @returns Tool output with created item details and optional equipped state
 */
export async function executeWardrobeCreateItemTool(
  input: unknown,
  context: WardrobeCreateItemToolContext
): Promise<WardrobeCreateItemToolOutput> {
  const repos = getRepositories();

  try {
    // Validate input
    if (!validateWardrobeCreateItemInput(input)) {
      logger.warn('Wardrobe create item tool validation failed', {
        context: 'wardrobe-create-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        input,
      });
      return {
        success: false,
        item_id: '',
        title: '',
        equipped: false,
        error: 'Invalid input: title (string) and types (non-empty array of valid slot types) are required',
      };
    }

    const { title, description, types, appropriateness, equip_now } = input;

    logger.debug('Creating wardrobe item', {
      context: 'wardrobe-create-item-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      title,
      types,
      equipNow: equip_now,
    });

    // Create the wardrobe item
    const newItem = await repos.wardrobe.create({
      characterId: context.characterId,
      title,
      description: description || null,
      types: types as WardrobeItemType[],
      appropriateness: appropriateness || null,
      isDefault: false,
    });

    logger.debug('Wardrobe item created', {
      context: 'wardrobe-create-item-handler',
      userId: context.userId,
      characterId: context.characterId,
      itemId: newItem.id,
      title: newItem.title,
    });

    let equipped = false;
    let currentState: EquippedSlots | undefined;

    // Equip immediately if requested
    if (equip_now) {
      logger.debug('Equipping new wardrobe item', {
        context: 'wardrobe-create-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        itemId: newItem.id,
        slots: newItem.types,
      });

      // Equip with displacement of conflicting items
      await equipWithDisplacement(repos, context.chatId, context.characterId, newItem);

      equipped = true;

      // Load current state after equipping
      const chat = await repos.chats.findById(context.chatId);
      if (chat) {
        const equippedOutfit = (chat as Record<string, unknown>).equippedOutfit as Record<string, EquippedSlots> | undefined;
        currentState = equippedOutfit?.[context.characterId] || { ...EMPTY_EQUIPPED_SLOTS };
      }

      logger.debug('Wardrobe item equipped', {
        context: 'wardrobe-create-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        itemId: newItem.id,
        currentState,
      });

      // Trigger avatar generation if enabled
      await triggerAvatarGenerationIfEnabled(repos, {
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        callerContext: 'wardrobe-create-item-handler',
      });
    }

    logger.info('Wardrobe create item completed', {
      context: 'wardrobe-create-item-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      itemId: newItem.id,
      title: newItem.title,
      equipped,
    });

    return {
      success: true,
      item_id: newItem.id,
      title: newItem.title,
      equipped,
      ...(currentState ? { current_state: currentState } : {}),
    };
  } catch (error) {
    logger.error('Wardrobe create item tool execution failed', {
      context: 'wardrobe-create-item-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      item_id: '',
      title: '',
      equipped: false,
      error: error instanceof Error ? error.message : 'Unknown error during wardrobe item creation',
    };
  }
}

/**
 * Format wardrobe create item results for inclusion in conversation context
 *
 * @param output - Wardrobe create item tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatWardrobeCreateItemResults(output: WardrobeCreateItemToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }

  const parts: string[] = [`Created wardrobe item "${output.title}" (${output.item_id})`];

  if (output.equipped) {
    parts.push('- Equipped immediately');

    if (output.current_state) {
      const slotSummary = WARDROBE_SLOT_TYPES
        .map((slot) => `  ${slot}: ${output.current_state![slot] || '(empty)'}`)
        .join('\n');
      parts.push(`- Current outfit:\n${slotSummary}`);
    }
  } else {
    parts.push('- Not equipped (added to wardrobe only)');
  }

  return parts.join('\n');
}
