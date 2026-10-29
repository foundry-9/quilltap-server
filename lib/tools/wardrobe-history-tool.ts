/**
 * Wardrobe History Tool Definition
 *
 * `wardrobe_history` lists the calling character's numbered outfits in this
 * chat — 0 is what they arrived in — with when each began, who made the
 * change, and a one-line summary. Read-only. Pairs with `wardrobe_rollback`.
 *
 * Gated by `canDressThemselves`, beside `wardrobe_wear` / `wardrobe_take_off`.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import type { WardrobeHistorySource } from '@/lib/schemas/chat-wardrobe-history.types'

/** Default window when `limit` is omitted. */
export const WARDROBE_HISTORY_DEFAULT_LIMIT = 20

/** Zod schema for the wardrobe_history tool's input. */
export const wardrobeHistoryToolInputSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .describe('How many of the most recent outfits to list. Default 20.')
    .optional(),
})

/** Input parameters for wardrobe_history */
export type WardrobeHistoryToolInput = z.infer<typeof wardrobeHistoryToolInputSchema>

/** One outfit in the listing. */
export interface WardrobeHistoryToolEntry {
  index: number;
  at: string;
  source: WardrobeHistorySource;
  changed_by: string;
  is_current: boolean;
  summary: string;
}

/** Output from wardrobe_history */
export interface WardrobeHistoryToolOutput {
  success: boolean;
  current_index: number | null;
  total: number;
  /** Ascending by index: the last `limit` entries, plus the current one if older. */
  entries: WardrobeHistoryToolEntry[];
  /** Set when the current entry was prepended from outside the window. */
  gap_before_window?: boolean;
  error?: string;
}

/** Tool definition compatible with OpenAI's tool_calls format */
export const wardrobeHistoryToolDefinition = {
  type: 'function',
  function: {
    name: 'wardrobe_history',
    description:
      'List the outfits you have worn in this chat, numbered from 0 (what you arrived in), ' +
      'with when each began, who made the change, and what it was. The one you are wearing ' +
      'now is marked. Use wardrobe_rollback with a number to return to one. A change made ' +
      'earlier in this same reply may not be listed yet.',
    parameters: zodToOpenAISchema(wardrobeHistoryToolInputSchema),
  },
};

/** Helper to validate tool input parameters */
export function validateWardrobeHistoryInput(input: unknown): WardrobeHistoryToolInput | null {
  const parsed = wardrobeHistoryToolInputSchema.safeParse(input ?? {})
  return parsed.success ? parsed.data : null
}

/** What this tool does to the world: reads, changes nothing. */
export const wardrobeHistoryToolEffect: ToolEffectSpec = 'read';
