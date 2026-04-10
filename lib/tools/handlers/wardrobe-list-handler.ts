/**
 * List Wardrobe Tool Handler
 *
 * Retrieves wardrobe items for a character, with optional filtering
 * by type and appropriateness. Shows equipped status per item.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeListToolInput, WardrobeListToolOutput, WardrobeListItemResult, WardrobeListPresetResult } from '../wardrobe-list-tool';
import { validateWardrobeListInput } from '../wardrobe-list-tool';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';

/**
 * Context required for wardrobe list tool execution
 */
export interface WardrobeListToolContext {
  /** User ID for authentication and logging */
  userId: string;
  /** Chat ID for equipped outfit lookup */
  chatId: string;
  /** Character ID whose wardrobe to list */
  characterId: string;
}

/**
 * Error thrown during wardrobe list execution
 */
export class WardrobeListError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NOT_FOUND'
  ) {
    super(message);
    this.name = 'WardrobeListError';
  }
}

/**
 * Determine which slot an item is equipped in, if any.
 * Returns the slot name or null.
 */
function findEquippedSlot(
  itemId: string,
  equippedSlots: EquippedSlots | null
): string | null {
  if (!equippedSlots) {
    return null;
  }

  for (const slot of WARDROBE_SLOT_TYPES) {
    if (equippedSlots[slot] === itemId) {
      return slot;
    }
  }

  return null;
}

/**
 * Execute the list_wardrobe tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID, chat ID, and character ID
 * @returns Tool output with filtered wardrobe items and equipped status
 */
export async function executeWardrobeListTool(
  input: unknown,
  context: WardrobeListToolContext
): Promise<WardrobeListToolOutput> {
  const repos = getRepositories();

  try {
    // Validate input
    if (!validateWardrobeListInput(input)) {
      logger.warn('Wardrobe list tool validation failed', {
        context: 'wardrobe-list-handler',
        userId: context.userId,
        characterId: context.characterId,
        input,
      });
      return {
        success: false,
        items: [],
        total_count: 0,
        error: 'Invalid input: type_filter must be a string array, appropriateness_filter must be a string, include_equipped must be a boolean',
      };
    }

    const validatedInput = input as WardrobeListToolInput;
    const { type_filter, appropriateness_filter, include_equipped, include_presets } = validatedInput;

    // Load all wardrobe items for the character
    logger.debug('Loading wardrobe items for character', {
      context: 'wardrobe-list-handler',
      characterId: context.characterId,
      chatId: context.chatId,
    });

    const allItemsRaw = await repos.wardrobe.findByCharacterId(context.characterId);

    // Filter out archived items
    const allItems = allItemsRaw.filter((item) => !item.archivedAt);

    logger.debug('Filtered archived wardrobe items', {
      context: 'wardrobe-list-handler',
      characterId: context.characterId,
      totalRaw: allItemsRaw.length,
      activeCount: allItems.length,
      archivedCount: allItemsRaw.length - allItems.length,
    });

    // Load current equipped outfit for the character in this chat
    logger.debug('Loading equipped outfit state', {
      context: 'wardrobe-list-handler',
      chatId: context.chatId,
      characterId: context.characterId,
    });

    const equippedSlots: EquippedSlots | null = await repos.chats.getEquippedOutfitForCharacter(
      context.chatId,
      context.characterId
    );

    // Filter items
    let filteredItems = allItems;

    // Filter by type if provided
    if (type_filter && type_filter.length > 0) {
      const lowerTypeFilter = type_filter.map((t) => t.toLowerCase());
      filteredItems = filteredItems.filter((item) =>
        item.types.some((type) => lowerTypeFilter.includes(type.toLowerCase()))
      );

      logger.debug('Applied type filter', {
        context: 'wardrobe-list-handler',
        type_filter: lowerTypeFilter,
        beforeCount: allItems.length,
        afterCount: filteredItems.length,
      });
    }

    // Filter by appropriateness if provided (case-insensitive substring match)
    if (appropriateness_filter && appropriateness_filter.trim() !== '') {
      const lowerFilter = appropriateness_filter.toLowerCase();
      filteredItems = filteredItems.filter(
        (item) =>
          item.appropriateness != null &&
          item.appropriateness.toLowerCase().includes(lowerFilter)
      );

      logger.debug('Applied appropriateness filter', {
        context: 'wardrobe-list-handler',
        appropriateness_filter: lowerFilter,
        afterCount: filteredItems.length,
      });
    }

    // Build result list with equipped status
    const resultItems: WardrobeListItemResult[] = filteredItems.map((item) => {
      const equippedSlot = findEquippedSlot(item.id, equippedSlots);
      return {
        item_id: item.id,
        title: item.title,
        description: item.description ?? null,
        types: item.types,
        appropriateness: item.appropriateness ?? null,
        is_equipped: equippedSlot !== null,
        equipped_slot: equippedSlot,
      };
    });

    // Filter out equipped items if include_equipped is explicitly false
    const finalItems =
      include_equipped === false
        ? resultItems.filter((item) => !item.is_equipped)
        : resultItems;

    // Fetch presets if requested (default true)
    let presets: WardrobeListPresetResult[] | undefined;
    if (include_presets !== false) {
      const rawPresets = await repos.outfitPresets.findByCharacterId(context.characterId);
      presets = rawPresets.map((preset) => ({
        preset_id: preset.id,
        name: preset.name,
        description: preset.description ?? null,
        slots: {
          top: preset.slots.top ?? null,
          bottom: preset.slots.bottom ?? null,
          footwear: preset.slots.footwear ?? null,
          accessories: preset.slots.accessories ?? null,
        },
      }));

      logger.debug('Loaded outfit presets for character', {
        context: 'wardrobe-list-handler',
        characterId: context.characterId,
        presetCount: presets.length,
      });
    }

    logger.info('Wardrobe list completed', {
      context: 'wardrobe-list-handler',
      userId: context.userId,
      characterId: context.characterId,
      chatId: context.chatId,
      totalItems: allItems.length,
      filteredCount: finalItems.length,
      hasTypeFilter: !!type_filter,
      hasAppropriatenessFilter: !!appropriateness_filter,
      includeEquipped: include_equipped !== false,
      includePresets: include_presets !== false,
      presetCount: presets?.length ?? 0,
    });

    return {
      success: true,
      items: finalItems,
      total_count: finalItems.length,
      presets,
    };
  } catch (error) {
    logger.error('Wardrobe list tool execution failed', {
      context: 'wardrobe-list-handler',
      userId: context.userId,
      characterId: context.characterId,
      chatId: context.chatId,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      items: [],
      total_count: 0,
      error: error instanceof Error ? error.message : 'Unknown error during wardrobe list operation',
    };
  }
}

/**
 * Format wardrobe list results for inclusion in conversation context
 *
 * @param output - Wardrobe list tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatWardrobeListResults(output: WardrobeListToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }

  if (output.items.length === 0) {
    return 'Wardrobe: No items found matching the specified filters.';
  }

  const lines: string[] = [`Wardrobe (${output.total_count} item${output.total_count !== 1 ? 's' : ''}):`];

  for (const item of output.items) {
    const typeTags = item.types.map((t) => `[${t}]`).join(' ');
    const equippedTag = item.is_equipped ? ` (EQUIPPED in ${item.equipped_slot})` : '';
    const appropriatenessTag = item.appropriateness ? ` | ${item.appropriateness}` : '';
    const description = item.description ? ` - ${item.description}` : '';

    lines.push(`  ${typeTags} ${item.title}${equippedTag}${appropriatenessTag}${description}`);
  }

  // Include presets if present
  if (output.presets && output.presets.length > 0) {
    lines.push('');
    lines.push(`Outfit Presets (${output.presets.length}):`);
    for (const preset of output.presets) {
      const description = preset.description ? ` - ${preset.description}` : '';
      const slotSummary = Object.entries(preset.slots)
        .filter(([, v]) => v !== null)
        .map(([k]) => k)
        .join(', ');
      lines.push(`  [${preset.preset_id}] ${preset.name}${description} (slots: ${slotSummary || 'none'})`);
    }
  }

  return lines.join('\n');
}
