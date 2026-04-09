/**
 * Create Wardrobe Item Tool Definition
 *
 * Provides a tool interface for LLMs to create new wardrobe items
 * and optionally equip them immediately.
 */

import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/**
 * Input parameters for the create wardrobe item tool
 */
export interface WardrobeCreateItemToolInput {
  /** Required: name of the item */
  title: string;
  /** Detailed description */
  description?: string;
  /** Required: coverage tags */
  types: string[];
  /** Context tags: 'casual', 'formal', etc. */
  appropriateness?: string;
  /** If true, equip immediately after creation (default false) */
  equip_now?: boolean;
}

/**
 * Output from the create wardrobe item tool
 */
export interface WardrobeCreateItemToolOutput {
  success: boolean;
  item_id: string;
  title: string;
  equipped: boolean;
  current_state?: {
    top: string | null;
    bottom: string | null;
    footwear: string | null;
    accessories: string | null;
  };
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const wardrobeCreateItemToolDefinition = {
  type: 'function',
  function: {
    name: 'create_wardrobe_item',
    description:
      'Create a new wardrobe item and optionally equip it immediately. ' +
      'Use this to design new outfits or clothing items.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The name of the wardrobe item.',
        },
        description: {
          type: 'string',
          description: 'A detailed description of the wardrobe item.',
        },
        types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['top', 'bottom', 'footwear', 'accessories'],
          },
          description:
            'Coverage tags indicating what body area(s) this item covers. ' +
            'For example, a dress might be ["top", "bottom"], while shoes would be ["footwear"].',
        },
        appropriateness: {
          type: 'string',
          description:
            'Context tags describing when this item is appropriate, such as "casual", "formal", "athletic", etc.',
        },
        equip_now: {
          type: 'boolean',
          description:
            'If true, equip the item immediately after creation. Defaults to false.',
          default: false,
        },
      },
      required: ['title', 'types'],
    },
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeCreateItemInput(
  input: unknown
): input is WardrobeCreateItemToolInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // title is required and must be a string
  if (typeof obj.title !== 'string' || obj.title.trim().length === 0) {
    return false;
  }

  // types is required and must be a non-empty array of valid type strings
  if (!Array.isArray(obj.types) || obj.types.length === 0) {
    return false;
  }
  for (const t of obj.types) {
    if (typeof t !== 'string') {
      return false;
    }
    if (!(WARDROBE_SLOT_TYPES as readonly string[]).includes(t)) {
      return false;
    }
  }

  // description is optional but must be a string if provided
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    return false;
  }

  // appropriateness is optional but must be a string if provided
  if (obj.appropriateness !== undefined && typeof obj.appropriateness !== 'string') {
    return false;
  }

  // equip_now is optional but must be a boolean if provided
  if (obj.equip_now !== undefined && typeof obj.equip_now !== 'boolean') {
    return false;
  }

  return true;
}
