/**
 * Set Outfit Tool Definition (composite items only)
 *
 * `wardrobe_set_outfit` operates on COMPOSITE wardrobe items — those whose
 * `componentItemIds` is non-empty (e.g. a "Rain Outfit" bundling raincoat +
 * jeans + boots). Two modes:
 *
 *   - `wear` — equip the composite. Each slot the composite covers is
 *              replaced with `[<composite-id>]`. The composite is stored as
 *              its own id; expansion to leaf garments happens at read time.
 *   - `remove` — take the composite off. The composite's id is filtered out
 *                of every slot it covers; layered items in those slots stay.
 *
 * For individual leaf items (a single garment), use `wardrobe_change_item`
 * with its `equip` / `add_to_slot` / `remove_from_slot` / `clear_slot` modes.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Zod schema for the wardrobe update outfit tool's input.
 */
export const wardrobeUpdateOutfitToolInputSchema = z.object({
  mode: z
    .enum(['wear', 'remove'])
    .describe(
      '"wear" — put the composite outfit on, replacing what was in those slots. ' +
      '"remove" — take the composite outfit off; layered items stay.'
    ),
  item_id: z
    .string()
    .describe(
      'The ID of the composite wardrobe item. The item must have components ' +
      '(componentItemIds non-empty); leaf items are rejected — use ' +
      'wardrobe_change_item for those.'
    )
    .optional(),
  item_title: z
    .string()
    .describe(
      'Fallback lookup by title if item_id is not known.'
    )
    .optional(),
})

/**
 * Input parameters for wardrobe_set_outfit
 */
export type WardrobeUpdateOutfitToolInput = z.infer<typeof wardrobeUpdateOutfitToolInputSchema>

/**
 * Output from wardrobe_set_outfit
 */
export interface WardrobeUpdateOutfitToolOutput {
  success: boolean;
  /** The action taken — "worn" for `wear`, "removed" for `remove`. */
  action: 'worn' | 'removed';
  /** The composite item involved. */
  item: { item_id: string; title: string } | null;
  /** Slots the composite covered (and therefore acted on). */
  slots_affected: string[];
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
export const wardrobeUpdateOutfitToolDefinition = {
  type: 'function',
  function: {
    name: 'wardrobe_set_outfit',
    description:
      'Put on or take off a composite outfit (a wardrobe item that bundles multiple ' +
      'other items, like a "Rain Outfit" or "Black-Tie Ensemble"). ' +
      'Use mode=wear to dress in the bundle (replaces whatever is currently in the ' +
      'slots the bundle covers). Use mode=remove to take the bundle off (clears the ' +
      'bundle\'s id from those slots, leaving any layered items alone). ' +
      'For individual garments, use wardrobe_change_item instead.',
    parameters: zodToOpenAISchema(wardrobeUpdateOutfitToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateWardrobeUpdateOutfitInput(
  input: unknown
): input is WardrobeUpdateOutfitToolInput {
  return wardrobeUpdateOutfitToolInputSchema.safeParse(input).success;
}
