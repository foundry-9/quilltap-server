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

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/**
 * Zod schema for the wardrobe create item tool's input.
 */
export const wardrobeCreateItemToolInputSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .refine((val) => val.trim().length > 0, { message: 'title cannot be empty or whitespace-only' })
      .describe('The name of the wardrobe item.'),
    description: z
      .string()
      .describe('A detailed description of the wardrobe item.')
      .optional(),
    types: z
      .array(z.enum(['top', 'bottom', 'footwear', 'accessories']))
      .nonempty()
      .describe(
        'Coverage tags indicating what body area(s) this item covers. ' +
        'Required for leaf items (no components). Optional and ignored for ' +
        'composite items — the slot coverage is computed from the components.'
      )
      .optional(),
    appropriateness: z
      .string()
      .describe(
        'Context tags describing when this item is appropriate, such as "casual", "formal", "athletic", etc.'
      )
      .optional(),
    equip_now: z
      .boolean()
      .default(false)
      .describe(
        'If true, equip the item immediately after creation. Defaults to false. ' +
        'For composites this places the composite (as a single id) into every slot it covers.'
      )
      .optional(),
    recipient: z
      .string()
      .refine((val) => val.trim().length > 0, { message: 'recipient cannot be empty or whitespace-only' })
      .describe(
        'Name of a character in this chat to give the item to. ' +
        'If omitted, the item is added to your own wardrobe.'
      )
      .optional(),
    component_item_ids: z
      .array(z.string().refine((s) => s.trim().length > 0, { message: 'component_item_ids entries must be non-empty' }))
      .describe(
        'IDs of existing wardrobe items that this new item bundles. ' +
        'Supplying this makes the new item a composite. The slots it covers ' +
        'are computed from the union of the components\' slots.'
      )
      .optional(),
    component_titles: z
      .array(z.string().refine((s) => s.trim().length > 0, { message: 'component_titles entries must be non-empty' }))
      .describe(
        'Titles of existing wardrobe items that this new item bundles, used ' +
        'as a fallback when component_item_ids are not known. Resolved against ' +
        'the calling character\'s wardrobe (case-insensitive).'
      )
      .optional(),
  })
  .refine(
    (obj) => {
      const hasComponents =
        (Array.isArray(obj.component_item_ids) && obj.component_item_ids.length > 0) ||
        (Array.isArray(obj.component_titles) && obj.component_titles.length > 0)
      return obj.types !== undefined || hasComponents
    },
    { message: 'either types (for leaf items) or components (for composites) must be supplied' }
  )

/**
 * Input parameters for the create wardrobe item tool
 */
export type WardrobeCreateItemToolInput = z.infer<typeof wardrobeCreateItemToolInputSchema>

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
    parameters: zodToOpenAISchema(wardrobeCreateItemToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeCreateItemInput(
  input: unknown
): input is WardrobeCreateItemToolInput {
  return wardrobeCreateItemToolInputSchema.safeParse(input).success;
}

/** Re-export the slot type for the union-of-types computation in the handler. */
export type CreateWardrobeItemSlotType = WardrobeItemType;
