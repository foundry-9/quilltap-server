/**
 * List Wardrobe Tool Definition
 *
 * Provides a tool interface for LLMs to browse a character's wardrobe items.
 * Supports filtering by type and appropriateness, and shows equipped status.
 */

/**
 * Input parameters for the list_wardrobe tool
 */
export interface WardrobeListToolInput {
  /** Filter by slot types: 'top', 'bottom', 'footwear', 'accessories' */
  type_filter?: string[];
  /** Filter by context: 'casual', 'formal', etc. */
  appropriateness_filter?: string;
  /** Whether to include currently equipped items (default true) */
  include_equipped?: boolean;
  /** Whether to include outfit presets in the response (default true) */
  include_presets?: boolean;
}

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
    parameters: {
      type: 'object',
      properties: {
        type_filter: {
          type: 'array',
          items: {
            type: 'string',
          },
          description:
            'Filter items by slot type. Possible values include "top", "bottom", "footwear", "accessories". ' +
            'Only items matching at least one of the specified types will be returned.',
        },
        appropriateness_filter: {
          type: 'string',
          description:
            'Filter items by appropriateness context, such as "casual", "formal", "athletic", etc. ' +
            'Only items matching the specified context will be returned.',
        },
        include_equipped: {
          type: 'boolean',
          description:
            'Whether to include currently equipped items in the results. Defaults to true.',
        },
        include_presets: {
          type: 'boolean',
          description:
            'Whether to include saved outfit presets in the response. Defaults to true.',
        },
      },
      required: [],
    },
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeListInput(input: unknown): input is WardrobeListToolInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // Validate type_filter if provided
  if (obj.type_filter !== undefined) {
    if (!Array.isArray(obj.type_filter)) {
      return false;
    }
    if (!obj.type_filter.every((item: unknown) => typeof item === 'string')) {
      return false;
    }
  }

  // Validate appropriateness_filter if provided
  if (obj.appropriateness_filter !== undefined) {
    if (typeof obj.appropriateness_filter !== 'string') {
      return false;
    }
  }

  // Validate include_equipped if provided
  if (obj.include_equipped !== undefined) {
    if (typeof obj.include_equipped !== 'boolean') {
      return false;
    }
  }

  // Validate include_presets if provided
  if (obj.include_presets !== undefined) {
    if (typeof obj.include_presets !== 'boolean') {
      return false;
    }
  }

  return true;
}
