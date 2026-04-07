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
  /** Which slot it's equipped in, if any */
  equipped_slot: string | null;
}

/**
 * Output from the list_wardrobe tool
 */
export interface WardrobeListToolOutput {
  success: boolean;
  items: WardrobeListItemResult[];
  total_count: number;
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
      'Each item includes its equipped status, showing what the character is currently wearing.',
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

  return true;
}
