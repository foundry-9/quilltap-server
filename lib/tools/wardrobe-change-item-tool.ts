/**
 * Change Wardrobe Item Tool Definition (atomic items only)
 *
 * `wardrobe_change_item` operates on individual leaf wardrobe items — those
 * whose `componentItemIds` is empty. Four modes:
 *
 *   - `equip`            — replace each slot the item covers with `[item.id]`.
 *                          The default "swap it on" gesture; multi-slot items
 *                          (a dress) cover top + bottom in one call.
 *   - `add_to_slot`      — append the item to a slot's array, layering it
 *                          over what's already there ("also wear the cardigan").
 *   - `remove_from_slot` — filter a specific item out of a slot. Omit
 *                          `item_id`/`item_title` to clear the slot entirely.
 *   - `clear_slot`       — clear all items from the named slot.
 *
 * For composite outfits (a wardrobe item that bundles others), use
 * `wardrobe_set_outfit` with mode `wear` or `remove` instead.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Zod schema for the wardrobe change item tool's input.
 */
export const wardrobeChangeItemToolInputSchema = z.object({
  mode: z
    .enum(['equip', 'add_to_slot', 'remove_from_slot', 'clear_slot'])
    .describe(
      '"equip" (replace slots covered by the item), ' +
      '"add_to_slot" (layer in a slot), ' +
      '"remove_from_slot" (take off one item), ' +
      '"clear_slot" (empty the slot entirely).'
    ),
  slot: z
    .enum(['top', 'bottom', 'footwear', 'accessories'])
    .describe(
      'Required for "add_to_slot", "remove_from_slot", and "clear_slot". ' +
      'Optional for "equip" — slots are inferred from the item.'
    )
    .optional(),
  item_id: z
    .string()
    .describe(
      'The ID of the wardrobe item. Required for "equip" and "add_to_slot". ' +
      'Optional for "remove_from_slot" (omit to clear the slot). ' +
      'Ignored by "clear_slot". The item must be a leaf (no components); ' +
      'composites are rejected — use wardrobe_set_outfit for those.'
    )
    .optional(),
  item_title: z
    .string()
    .describe('Fallback lookup by title if item_id is not known.')
    .optional(),
})

/**
 * Input parameters for wardrobe_change_item
 */
export type WardrobeChangeItemToolInput = z.infer<typeof wardrobeChangeItemToolInputSchema>

/**
 * Output from wardrobe_change_item
 */
export interface WardrobeChangeItemToolOutput {
  success: boolean;
  /** What happened: `equipped` for equip/add_to_slot; `removed` for remove/clear. */
  action: 'equipped' | 'removed';
  /** The slot acted on (or `'inferred'` for an `equip` that touched multiple). */
  slot: string;
  /** The item involved, when applicable. */
  item: { item_id: string; title: string } | null;
  /** Per-slot arrays of equipped item IDs after the mutation. */
  current_state: {
    top: string[];
    bottom: string[];
    footwear: string[];
    accessories: string[];
  };
  coverage_summary: string;
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const wardrobeChangeItemToolDefinition = {
  type: 'function',
  function: {
    name: 'wardrobe_change_item',
    description:
      'Change what a single wardrobe item is doing on the character. ' +
      'Use mode=equip to put on a single garment (replacing whatever is in the ' +
      'slots it covers). Use mode=add_to_slot to layer an item over what is ' +
      'already worn ("also a cardigan"). Use mode=remove_from_slot to take off ' +
      'one specific item (or omit item_id to empty the slot). Use mode=clear_slot ' +
      'to empty a slot entirely. ' +
      'For composite outfits (wardrobe items that bundle several pieces), use ' +
      'wardrobe_set_outfit instead.',
    parameters: zodToOpenAISchema(wardrobeChangeItemToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeChangeItemInput(
  input: unknown
): input is WardrobeChangeItemToolInput {
  return wardrobeChangeItemToolInputSchema.safeParse(input).success;
}
