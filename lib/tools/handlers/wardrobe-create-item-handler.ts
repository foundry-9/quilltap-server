/**
 * Create Wardrobe Item Tool Handler
 *
 * Creates new wardrobe items and optionally equips them immediately.
 * Supports gifting items to other characters in the chat via the
 * optional `recipient` parameter.
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
 * Resolve a recipient character ID from a name string by searching chat participants.
 * Returns { characterId, characterName } or null if not found.
 */
async function resolveRecipientFromChat(
  chatId: string,
  recipientName: string,
  callingCharacterId: string,
): Promise<{ characterId: string; characterName: string } | null> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);
  if (!chat) return null;

  const participants = (chat as Record<string, unknown>).participants as Array<{
    characterId?: string;
    status?: string;
  }> | undefined;

  if (!participants || !Array.isArray(participants)) return null;

  // Normalize the search name for case-insensitive matching
  const normalizedSearch = recipientName.trim().toLowerCase();

  // Search through active participants for a character name match
  for (const participant of participants) {
    // Skip removed participants
    if (participant.status === 'removed') continue;

    const charId = participant.characterId;
    if (!charId) continue;

    // Look up the character record to get the name
    const character = await repos.characters.findById(charId);
    if (!character) continue;

    if (character.name.trim().toLowerCase() === normalizedSearch) {
      return { characterId: charId, characterName: character.name };
    }
  }

  return null;
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

    const { title, description, types, appropriateness, equip_now, recipient } = input;

    // Resolve the target character — defaults to the calling character
    let targetCharacterId = context.characterId;
    let recipientName: string | undefined;

    if (recipient) {
      const resolved = await resolveRecipientFromChat(
        context.chatId,
        recipient,
        context.characterId,
      );

      if (!resolved) {
        logger.warn('Wardrobe create item recipient not found in chat', {
          context: 'wardrobe-create-item-handler',
          userId: context.userId,
          chatId: context.chatId,
          recipientName: recipient,
        });
        return {
          success: false,
          item_id: '',
          title: '',
          equipped: false,
          error: `Could not find a character named "${recipient}" in this chat`,
        };
      }

      targetCharacterId = resolved.characterId;
      recipientName = resolved.characterName;

      logger.debug('Resolved gift recipient', {
        context: 'wardrobe-create-item-handler',
        recipientName: resolved.characterName,
        recipientCharacterId: resolved.characterId,
        callingCharacterId: context.characterId,
      });
    }

    logger.debug('Creating wardrobe item', {
      context: 'wardrobe-create-item-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      targetCharacterId,
      recipientName,
      title,
      types,
      equipNow: equip_now,
    });

    // Create the wardrobe item for the target character
    const newItem = await repos.wardrobe.create({
      characterId: targetCharacterId,
      title,
      description: description || null,
      types: types as WardrobeItemType[],
      appropriateness: appropriateness || null,
      isDefault: false,
    });

    logger.debug('Wardrobe item created', {
      context: 'wardrobe-create-item-handler',
      userId: context.userId,
      targetCharacterId,
      recipientName,
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
        targetCharacterId,
        itemId: newItem.id,
        slots: newItem.types,
      });

      // Equip on the target character (may be a gift recipient)
      await equipWithDisplacement(repos, context.chatId, targetCharacterId, newItem);

      equipped = true;

      // Load current state after equipping
      const chat = await repos.chats.findById(context.chatId);
      if (chat) {
        const equippedOutfit = (chat as Record<string, unknown>).equippedOutfit as Record<string, EquippedSlots> | undefined;
        currentState = equippedOutfit?.[targetCharacterId] || { ...EMPTY_EQUIPPED_SLOTS };
      }

      logger.debug('Wardrobe item equipped', {
        context: 'wardrobe-create-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        targetCharacterId,
        itemId: newItem.id,
        currentState,
      });

      // Trigger avatar generation for the target character if enabled
      await triggerAvatarGenerationIfEnabled(repos, {
        userId: context.userId,
        chatId: context.chatId,
        characterId: targetCharacterId,
        callerContext: 'wardrobe-create-item-handler',
      });
    }

    logger.info('Wardrobe create item completed', {
      context: 'wardrobe-create-item-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      targetCharacterId,
      recipientName,
      itemId: newItem.id,
      title: newItem.title,
      equipped,
    });

    return {
      success: true,
      item_id: newItem.id,
      title: newItem.title,
      equipped,
      ...(recipientName ? { recipient_name: recipientName } : {}),
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

  const recipientNote = output.recipient_name
    ? ` for ${output.recipient_name}`
    : '';

  const parts: string[] = [`Created wardrobe item "${output.title}" (${output.item_id})${recipientNote}`];

  if (output.equipped) {
    parts.push(`- Equipped immediately${recipientNote ? ` on ${output.recipient_name}` : ''}`);

    if (output.current_state) {
      const slotSummary = WARDROBE_SLOT_TYPES
        .map((slot) => `  ${slot}: ${output.current_state![slot] || '(empty)'}`)
        .join('\n');
      parts.push(`- Current outfit:\n${slotSummary}`);
    }
  } else {
    parts.push(`- Not equipped (added to wardrobe${recipientNote ? ` of ${output.recipient_name}` : ''} only)`);
  }

  return parts.join('\n');
}
