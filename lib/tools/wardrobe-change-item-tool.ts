/**
 * Change Wardrobe Item Tool Definition (atomic items only)
 *
 * `wardrobe_change_item` operates on individual leaf wardrobe items — those
 * whose `componentItemIds` is empty. Five modes:
 *
 *   - `wear`             — put the item on across every slot it covers,
 *                          honoring the item's `replace` flag: off (the default
 *                          for single garments) layers it over what's already
 *                          there; on, it replaces those slots.
 *   - `replace`          — force a swap: clear each slot the item covers, then
 *                          put the item on (take off what's there, wear this).
 *   - `add_to_slot`      — append the item to one named slot's array, layering
 *                          it over what's already there ("also wear the cardigan").
 *   - `remove_from_slot` — filter a specific item out of a slot. Omit
 *                          `item_id`/`item_title` to clear the slot entirely.
 *   - `clear_slot`       — clear all items from the named slot.
 *
 * For composite outfits (a wardrobe item that bundles others), use
 * `wardrobe_set_outfit` with mode `wear`, `replace`, or `remove` instead.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Zod schema for the wardrobe change item tool's input.
 */
export const wardrobeChangeItemToolInputSchema = z.object({
  mode: z
    .enum(['wear', 'replace', 'add_to_slot', 'remove_from_slot', 'clear_slot'])
    .describe(
      '"wear" (put it on honoring the item\'s replace flag — layers if the flag ' +
      'is off, replaces the slots if on), ' +
      '"replace" (clear the slots it covers, then put it on — a forced swap), ' +
      '"add_to_slot" (layer into one slot), ' +
      '"remove_from_slot" (take off one item), ' +
      '"clear_slot" (empty the slot entirely).'
    ),
  slot: z
    .enum(['top', 'bottom', 'footwear', 'accessories'])
    .describe(
      'Required for "add_to_slot", "remove_from_slot", and "clear_slot". ' +
      'Optional for "wear"/"replace" — slots are inferred from the item.'
    )
    .optional(),
  item_id: z
    .string()
    .describe(
      'The ID of the wardrobe item. Required for "wear", "replace", and ' +
      '"add_to_slot". Optional for "remove_from_slot" (omit to clear the slot). ' +
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
  /** What happened: `equipped` for wear/replace/add_to_slot; `removed` for remove/clear. */
  action: 'equipped' | 'removed';
  /**
   * What the mutation did to the slots it touched, so the model knows whether
   * existing items survived: `layered` (added on top, others kept), `replaced`
   * (slots cleared and set to this item), `removed` (one item taken off), or
   * `cleared` (slots emptied).
   */
  effect: 'layered' | 'replaced' | 'removed' | 'cleared';
  /** One-sentence, plain-language description of `effect` for the model. */
  effect_summary: string;
  /** The slot acted on (or `'inferred'` for a wear/replace that touched multiple). */
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
      "Use mode=wear to put a garment on: it honors the item's replace flag — " +
      'off (the usual case for single garments) layers it over what is already ' +
      'worn, on replaces those slots. Use mode=replace to force a swap (clear ' +
      'the slots it covers, then put it on) — reach for this when wearing a ' +
      'garment should take off what was there. Use mode=add_to_slot to layer an ' +
      'item into one slot ("also a cardigan"). Use mode=remove_from_slot to take ' +
      'off one specific item (or omit item_id to empty the slot). Use ' +
      'mode=clear_slot to empty a slot entirely. The response reports the exact ' +
      'effect (layered vs replaced) per call. ' +
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
