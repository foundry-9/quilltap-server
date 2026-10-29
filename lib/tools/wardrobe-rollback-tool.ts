/**
 * Wardrobe Rollback Tool Definition
 *
 * `wardrobe_rollback` returns the calling character to an outfit they wore
 * earlier in this chat, by its number in `wardrobe_history`. With no index it
 * steps back one. Rolling back is itself a change of clothes: it is announced,
 * and the next real change becomes a new numbered outfit at the end.
 *
 * Gated by `canDressThemselves`, beside `wardrobe_wear` / `wardrobe_take_off`.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'

/** Zod schema for the wardrobe_rollback tool's input. */
export const wardrobeRollbackToolInputSchema = z.object({
  index: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'The outfit to return to, by its number in wardrobe_history. Omit to step back ' +
      'one outfit from the current one. Any recorded number is allowed, earlier or later than ' +
      'the current one.'
    )
    .optional(),
})

/** Input parameters for wardrobe_rollback */
export type WardrobeRollbackToolInput = z.infer<typeof wardrobeRollbackToolInputSchema>

/** One garment the rollback could not put back on. */
export interface WardrobeRollbackSkippedItem {
  item_id: string;
  title: string | null;
  reason: 'archived' | 'missing';
}

/** Output from wardrobe_rollback */
export interface WardrobeRollbackToolOutput {
  success: boolean;
  previous_index?: number;
  restored_index?: number;
  current_state?: Record<WardrobeItemType, string[]>;
  coverage_summary?: string;
  skipped?: WardrobeRollbackSkippedItem[];
  error?: string;
}

/** Tool definition compatible with OpenAI's tool_calls format */
export const wardrobeRollbackToolDefinition = {
  type: 'function',
  function: {
    name: 'wardrobe_rollback',
    description:
      'Return to an outfit you wore earlier in this chat. Every outfit change is numbered ' +
      'from 0 (what you arrived in); wardrobe_history lists them. With no index this steps ' +
      'back one. Rolling back is itself a change of clothes: it is announced, and the next ' +
      'thing you put on becomes a new numbered outfit at the end of the list.',
    parameters: zodToOpenAISchema(wardrobeRollbackToolInputSchema),
  },
};

/** Helper to validate tool input parameters */
export function validateWardrobeRollbackInput(input: unknown): WardrobeRollbackToolInput | null {
  const parsed = wardrobeRollbackToolInputSchema.safeParse(input ?? {})
  return parsed.success ? parsed.data : null
}

/** What this tool does to the world: changes stored state. */
export const wardrobeRollbackToolEffect: ToolEffectSpec = 'write';
