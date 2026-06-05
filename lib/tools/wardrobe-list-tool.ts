/**
 * List Wardrobe Tool Definition
 *
 * Provides a tool interface for LLMs to browse a character's wardrobe items.
 * Supports filtering by type and appropriateness, and shows equipped status.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Zod schema for the wardrobe list tool's input.
 */
export const wardrobeListToolInputSchema = z.object({
  type_filter: z
    .array(z.string())
    .describe(
      'Filter items by slot type. Possible values include "top", "bottom", "footwear", "accessories". ' +
      'Only items matching at least one of the specified types will be returned.'
    )
    .optional(),
  appropriateness_filter: z
    .string()
    .describe(
      'Filter items by appropriateness context, such as "casual", "formal", "athletic", etc. ' +
      'Only items matching the specified context will be returned.'
    )
    .optional(),
  include_equipped: z
    .boolean()
    .describe(
      'Whether to include currently equipped items in the results. Defaults to true.'
    )
    .optional(),
  include_presets: z
    .boolean()
    .describe(
      'Whether to include saved outfit presets in the response. Defaults to true.'
    )
    .optional(),
})

/**
 * Input parameters for the list_wardrobe tool
 */
export type WardrobeListToolInput = z.infer<typeof wardrobeListToolInputSchema>

/**
 * A single wardrobe item in the result list
 */
export interface WardrobeListItemResult {
  item_id: string;
  title: string;
  description: string | null;
  types: string[];
  appropriateness: string | null;
  is_equipped: boolean;
  /**
   * Which slot the item is currently equipped in (the first if multi-slot
   * coverage). With arrays-per-slot this is the simplest single-value
   * back-compat field; consumers that need the full set should consult
   * `equippedOutfit` directly.
   */
  equipped_slot: string | null;
  /** True when this item is a composite (has `componentItemIds`). */
  is_composite?: boolean;
  /** Component item IDs (only populated for composites). */
  component_item_ids?: string[];
  /** Resolved component titles (best-effort; missing components are dropped). */
  component_titles?: string[];
}

/**
 * A preset summary in the result list
 */
export interface WardrobeListPresetResult {
  preset_id: string;
  name: string;
  description: string | null;
  slots: {
    top: string | null;
    bottom: string | null;
    footwear: string | null;
    accessories: string | null;
  };
}

/**
 * Output from the list_wardrobe tool
 */
export interface WardrobeListToolOutput {
  success: boolean;
  items: WardrobeListItemResult[];
  total_count: number;
  /** Outfit presets available for this character */
  presets?: WardrobeListPresetResult[];
  /** Error message if operation failed */
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const wardrobeListToolDefinition = {
  type: 'function',
  function: {
    name: 'list_wardrobe',
    description:
      'Retrieve wardrobe items for the current character. ' +
      'Returns clothing and accessory items from the character\'s wardrobe, ' +
      'with optional filtering by item type and appropriateness context. ' +
      'Each item includes its equipped status (which slot[s] it occupies, if any) ' +
      'and a composite flag indicating whether it bundles other items. ' +
      'Use wardrobe_change_item to put on / take off / layer single garments, ' +
      'and wardrobe_set_outfit to wear or remove a composite outfit. ' +
      'Archived items are excluded from results.',
    parameters: zodToOpenAISchema(wardrobeListToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeListInput(input: unknown): input is WardrobeListToolInput {
  return wardrobeListToolInputSchema.safeParse(input).success;
}
