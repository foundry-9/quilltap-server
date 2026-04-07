/**
 * Update Outfit Item Tool Definition
 *
 * Provides a tool interface for LLMs to equip or remove wardrobe items
 * from specific outfit slots (top, bottom, footwear, accessories).
 */

/**
 * Input parameters for the update_outfit_item tool
 */
export interface WardrobeUpdateOutfitToolInput {
  /** Required: which slot to modify */
  slot: string;
  /** ID of item to equip (omit to unequip) */
  item_id?: string;
  /** Title fallback if ID unknown */
  item_title?: string;
}

/**
 * Output from the update_outfit_item tool
 */
export interface WardrobeUpdateOutfitToolOutput {
  success: boolean;
  action: 'equipped' | 'removed';
  slot: string;
  item: { item_id: string; title: string } | null;
  current_state: {
    top: string | null;
    bottom: string | null;
    footwear: string | null;
    accessories: string | null;
  };
  coverage_summary: string;
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const wardrobeUpdateOutfitToolDefinition = {
  type: 'function',
  function: {
    name: 'update_outfit_item',
    description:
      'Equip or remove a wardrobe item. Provide slot and item_id/item_title to equip, or just slot to remove.',
    parameters: {
      type: 'object',
      properties: {
        slot: {
          type: 'string',
          enum: ['top', 'bottom', 'footwear', 'accessories'],
          description:
            'The outfit slot to modify: "top", "bottom", "footwear", or "accessories".',
        },
        item_id: {
          type: 'string',
          description:
            'The ID of the wardrobe item to equip in the slot. Omit to remove the current item from the slot.',
        },
        item_title: {
          type: 'string',
          description:
            'Fallback lookup by title if item_id is not known. Used to find the wardrobe item by its title.',
        },
      },
      required: ['slot'],
    },
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeUpdateOutfitInput(
  input: unknown
): input is WardrobeUpdateOutfitToolInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // slot is required
  if (obj.slot === undefined) {
    return false;
  }

  // Validate slot
  if (typeof obj.slot !== 'string') {
    return false;
  }
  if (!['top', 'bottom', 'footwear', 'accessories'].includes(obj.slot)) {
    return false;
  }

  // Validate item_id if provided
  if (obj.item_id !== undefined && typeof obj.item_id !== 'string') {
    return false;
  }

  // Validate item_title if provided
  if (obj.item_title !== undefined && typeof obj.item_title !== 'string') {
    return false;
  }

  return true;
}
