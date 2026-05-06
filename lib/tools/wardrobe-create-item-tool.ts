/**
 * Create Wardrobe Item Tool Definition
 *
 * Provides a tool interface for LLMs to create new wardrobe items —
 * either leaf items (a single garment) or composite items (a bundle of
 * other wardrobe items, like a "Rain Outfit" containing a coat, jeans,
 * and boots).
 *
 * For leaf items: provide `title` and `types` (the slots the item covers).
 * For composite items: provide `title` plus EITHER `component_item_ids` or
 * `component_titles` (or both) — the slots it covers are computed from the
 * union of its components' slots, and the LLM-supplied `types` is ignored
 * if it disagrees. Cycles are rejected by the repository at save time.
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
  /**
   * Required for leaf items, optional for composites (computed from
   * components when omitted). If supplied for a composite, the union of
   * the components' types is the source of truth and overrides this.
   */
  types?: string[];
  /** Context tags: 'casual', 'formal', etc. */
  appropriateness?: string;
  /** If true, equip immediately after creation (default false) */
  equip_now?: boolean;
  /** Optional: name of the character to give this item to. Defaults to the calling character. */
  recipient?: string;
  /**
   * Make this a composite item by referencing other wardrobe items.
   * Supply component IDs (preferred — unambiguous) and/or titles
   * (fallback when IDs aren't to hand). The handler resolves both,
   * deduplicates, and rejects unknown items. Cycles are rejected by
   * the repository at save time.
   */
  component_item_ids?: string[];
  /** Title fallback for component lookup. Resolved against the calling character's wardrobe. */
  component_titles?: string[];
}

/**
 * Output from the create wardrobe item tool
 */
export interface WardrobeCreateItemToolOutput {
  success: boolean;
  item_id: string;
  title: string;
  equipped: boolean;
  /** True if the created item is a composite (has components). */
  is_composite?: boolean;
  /** The item types resolved by the handler — for composites, the computed union. */
  resolved_types?: string[];
  /** Component item IDs the handler actually persisted (post-resolution, deduped). */
  resolved_component_item_ids?: string[];
  /** Name of the character who received the item (when gifted to another) */
  recipient_name?: string;
  /**
   * Equipped slots after the create-and-equip. Each slot holds an array of
   * wardrobe item IDs (multi-item slots support layering).
   */
  current_state?: {
    top: string[];
    bottom: string[];
    footwear: string[];
    accessories: string[];
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
      'Use this for two cases: (1) a single garment — supply title and types ' +
      '(e.g. ["top"] for a shirt, ["top","bottom"] for a dress); or (2) a composite ' +
      'outfit that bundles other wardrobe items — supply title and component_item_ids ' +
      '(or component_titles) referring to existing items in the character\'s wardrobe. ' +
      'For composites, the slots covered are computed from the union of the components\' ' +
      'slots, so you do not need to supply types yourself. ' +
      'You can give the item to another character in the chat by specifying a recipient.',
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
            'Required for leaf items (no components). Optional and ignored for ' +
            'composite items — the slot coverage is computed from the components.',
        },
        appropriateness: {
          type: 'string',
          description:
            'Context tags describing when this item is appropriate, such as "casual", "formal", "athletic", etc.',
        },
        equip_now: {
          type: 'boolean',
          description:
            'If true, equip the item immediately after creation. Defaults to false. ' +
            'For composites this places the composite (as a single id) into every slot it covers.',
          default: false,
        },
        recipient: {
          type: 'string',
          description:
            'Name of a character in this chat to give the item to. ' +
            'If omitted, the item is added to your own wardrobe.',
        },
        component_item_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'IDs of existing wardrobe items that this new item bundles. ' +
            'Supplying this makes the new item a composite. The slots it covers ' +
            'are computed from the union of the components\' slots.',
        },
        component_titles: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Titles of existing wardrobe items that this new item bundles, used ' +
            'as a fallback when component_item_ids are not known. Resolved against ' +
            'the calling character\'s wardrobe (case-insensitive).',
        },
      },
      required: ['title'],
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

  // types is required for leaf items, optional for composites; if present must
  // be a non-empty array of valid type strings.
  const hasComponents =
    (Array.isArray(obj.component_item_ids) && obj.component_item_ids.length > 0) ||
    (Array.isArray(obj.component_titles) && obj.component_titles.length > 0);

  if (obj.types !== undefined) {
    if (!Array.isArray(obj.types) || obj.types.length === 0) {
      return false;
    }
    for (const t of obj.types) {
      if (typeof t !== 'string') return false;
      if (!(WARDROBE_SLOT_TYPES as readonly string[]).includes(t)) return false;
    }
  } else if (!hasComponents) {
    // Neither types nor components — can't determine slot coverage.
    return false;
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

  // recipient is optional but must be a non-empty string if provided
  if (obj.recipient !== undefined && (typeof obj.recipient !== 'string' || obj.recipient.trim().length === 0)) {
    return false;
  }

  // component_item_ids/component_titles must be arrays of non-empty strings if present
  if (obj.component_item_ids !== undefined) {
    if (!Array.isArray(obj.component_item_ids)) return false;
    for (const id of obj.component_item_ids) {
      if (typeof id !== 'string' || id.trim().length === 0) return false;
    }
  }
  if (obj.component_titles !== undefined) {
    if (!Array.isArray(obj.component_titles)) return false;
    for (const t of obj.component_titles) {
      if (typeof t !== 'string' || t.trim().length === 0) return false;
    }
  }

  return true;
}

/** Re-export the slot type for the union-of-types computation in the handler. */
export type CreateWardrobeItemSlotType = WardrobeItemType;
