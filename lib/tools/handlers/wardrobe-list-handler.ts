/**
 * List Wardrobe Tool Handler
 *
 * Retrieves wardrobe items for a character, with optional filtering by type
 * and appropriateness. Shows equipped status per item, marks composite items
 * (with `componentItemIds`) and lists their component titles for the LLM.
 *
 * Outfit presets are no longer a separate concept — composites are wardrobe
 * items addressed by id like everything else, so they show up in the same
 * listing.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeListToolInput, WardrobeListToolOutput, WardrobeListItemResult } from '../wardrobe-list-tool';
import { validateWardrobeListInput } from '../wardrobe-list-tool';
import { isComposite as itemIsComposite } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';
import { findEquippedSlots, loadToolPool, type WardrobeToolContext } from './wardrobe-handler-shared';
import { formatWornRelative } from '@/lib/wardrobe/wear-display';
import { neverWornSummary } from '@/lib/schemas/wardrobe-wear.types';
import { formatWardrobeImageHandle } from '@/lib/wardrobe/tool-image-generation';

/** Every wardrobe tool runs in the same context (see `WardrobeToolContext`). */
export type WardrobeListToolContext = WardrobeToolContext;

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
 * Execute the wardrobe_list tool
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
    const parsed = validateWardrobeListInput(input);
    if (!parsed) {
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
        error:
          'Invalid input: type_filter must be a string array, appropriateness_filter must be a string, include_equipped must be a boolean',
      };
    }

    const validatedInput = parsed;
    const { type_filter, appropriateness_filter, include_equipped } = validatedInput;

    // Everything the character can wear: their own vault over their groups'
    // stores, the chat's project stores and Quilltap General.
    const pool = await loadToolPool(repos, context.chatId, context.characterId);
    const allItems = pool.wearable();

    const equippedSlots: EquippedSlots | null = await repos.chats.getEquippedOutfitForCharacter(
      context.chatId,
      context.characterId
    );

    let filteredItems = allItems;

    if (type_filter && type_filter.length > 0) {
      const lowerTypeFilter = type_filter.map((t) => t.toLowerCase());
      filteredItems = filteredItems.filter((item) =>
        item.types.some((type) => lowerTypeFilter.includes(type.toLowerCase()))
      );
    }

    if (appropriateness_filter && appropriateness_filter.trim() !== '') {
      const lowerFilter = appropriateness_filter.toLowerCase();
      filteredItems = filteredItems.filter(
        (item) =>
          item.appropriateness != null &&
          item.appropriateness.toLowerCase().includes(lowerFilter)
      );
    }


    // One ledger read for every listed item's wear, the caller's own share
    // kept apart from the household's (bug 184).
    const wearSummaries = await repos.wardrobeWear.findSummariesForWearer(
      filteredItems.map((item) => item.id),
      context.characterId,
    );

    // Build result list with equipped status and composite metadata.
    const resultItems: WardrobeListItemResult[] = filteredItems.map((item) => {
      const equipped = findEquippedSlots(item.id, equippedSlots);
      const wear = wearSummaries.get(item.id);
      const household = wear?.household ?? neverWornSummary();
      const yours = wear?.yours ?? neverWornSummary();
      // Component titles resolve against the whole pool, so a filtered-out
      // (or archived) part still names itself.
      const isComposite = itemIsComposite(item);
      const componentTitles = isComposite
        ? pool.getMany(item.componentItemIds).map((c) => c.title)
        : undefined;
      return {
        item_id: item.id,
        title: item.title,
        description: item.description ?? null,
        image_prompt: item.imagePrompt ?? null,
        image_file_id: item.imageFileId ?? null,
        types: item.types,
        appropriateness: item.appropriateness ?? null,
        is_own: item.characterId === context.characterId,
        is_equipped: equipped.length > 0,
        // Preserve the original single-slot field shape; with arrays-per-slot
        // we expose the *first* slot the item appears in for back-compat,
        // and the full set on `equipped_slots`.
        equipped_slot: equipped[0] ?? null,
        wear_count: household.wearCount,
        last_worn_at: household.lastWornAt,
        worn_by_you: yours.wearCount,
        last_worn_by_you_at: yours.lastWornAt,
        ...(isComposite
          ? {
              is_composite: true,
              component_item_ids: item.componentItemIds,
              component_titles: componentTitles,
            }
          : {}),
      } as WardrobeListItemResult;
    });

    // Filter out equipped items if include_equipped is explicitly false
    const finalItems =
      include_equipped === false
        ? resultItems.filter((item) => !item.is_equipped)
        : resultItems;

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
      compositeCount: finalItems.filter((i) => i.is_composite).length,
      neverWornCount: finalItems.filter((i) => i.wear_count === 0).length,
      neverWornByCallerCount: finalItems.filter((i) => i.worn_by_you === 0).length,
      withPictureCount: finalItems.filter((i) => i.image_file_id).length,
    });

    return {
      success: true,
      items: finalItems,
      total_count: finalItems.length,
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

/** "once" or "12×", for the compact list note. */
function listTimes(count: number): string {
  return count === 1 ? 'once' : `${count}×`;
}

/**
 * The compact wear note a listed item carries, from the caller's side with
 * the household's total as context (bug 184):
 *
 *  - ` · never worn` — nobody has
 *  - ` · never worn by you (worn 115× by others)`
 *  - ` · worn by you 12×, last yesterday` — only the caller has worn it
 *  - ` · worn by you 12×, last yesterday (115× in the household)`
 *
 * `nowMs` pins the clock (tests); it defaults to now.
 */
export function formatWardrobeListWearNote(
  item: Pick<WardrobeListItemResult, 'wear_count' | 'last_worn_at' | 'worn_by_you' | 'last_worn_by_you_at'>,
  nowMs: number = Date.now(),
): string {
  if (!item.wear_count) return ' · never worn';
  if (!item.worn_by_you) return ` · never worn by you (worn ${listTimes(item.wear_count)} by others)`;
  // A count with no readable date (a hand-edited row) drops the date part.
  const yourLastMs = item.last_worn_by_you_at ? Date.parse(item.last_worn_by_you_at) : NaN;
  const when = Number.isNaN(yourLastMs) ? '' : `, last ${formatWornRelative(yourLastMs, nowMs)}`;
  const yours = `worn by you ${listTimes(item.worn_by_you)}${when}`;
  if (item.wear_count <= item.worn_by_you) return ` · ${yours}`;
  return ` · ${yours} (${listTimes(item.wear_count)} in the household)`;
}

/**
 * Format wardrobe list results for inclusion in conversation context
 *
 * @param output - Wardrobe list tool output to format
 * @param nowMs - Clock for the relative wear dates; defaults to now
 * @returns Formatted string suitable for LLM context and display
 */
export function formatWardrobeListResults(
  output: WardrobeListToolOutput,
  nowMs: number = Date.now(),
): string {
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
    const sharedTag = item.is_own ? '' : ' [shared — read-only]';
    const appropriatenessTag = item.appropriateness ? ` | ${item.appropriateness}` : '';
    const description = item.description ? ` - ${item.description}` : '';
    const cueTag = item.image_prompt ? ` (cue: ${item.image_prompt})` : '';
    const compositeTag = item.is_composite
      ? ` [composite: ${(item.component_titles ?? []).join(', ') || 'unresolved components'}]`
      : '';

    const wearTag = formatWardrobeListWearNote(item, nowMs);
    const pictureTag = item.image_file_id ? ` · picture: ${formatWardrobeImageHandle(item.image_file_id)}` : '';

    lines.push(`  ${typeTags} ${item.title}${equippedTag}${sharedTag}${appropriatenessTag}${compositeTag}${cueTag}${description}${wearTag}${pictureTag}`);
  }

  return lines.join('\n');
}
