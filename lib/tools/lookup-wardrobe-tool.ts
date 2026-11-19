/**
 * @fileoverview Tool definitions for the research kit's `lookup_wardrobe` and
 * `lookup_atlas` (docs/developer/features/research-kit.md §5.7) — the two
 * questions that recur in the logs: what someone can wear, and what an Atlas
 * entry says.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schemas are the single
 * source of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * the validators are one-line `safeParse(...).success` delegates. The logic
 * lives in `lib/research/records.ts`. Operator surface only.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const lookupWardrobeToolInputSchema = z.object({
  owner: z
    .string()
    .min(1)
    .describe(
      "Whose wardrobe: a character's name (every piece they can reach, with their dressing instructions), " +
        "or `project:Name`, `group:Name`, `general` for that tier's rail alone."
    ),
  query: z.string().min(1).optional().describe('Only pieces with these words in their title or description.'),
  include_archived: z.boolean().optional().describe('Include archived pieces (default false).'),
});

export type LookupWardrobeInput = z.infer<typeof lookupWardrobeToolInputSchema>;

export function validateLookupWardrobeInput(input: unknown): boolean {
  return lookupWardrobeToolInputSchema.safeParse(input).success;
}

export const lookupWardrobeToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup_wardrobe',
    description:
      'Look up a wardrobe in ONE call: for a character, their dressing instructions and every piece they can ' +
      'reach (title, slots, when it suits, tier); for `project:`, `group:` or `general`, that rail. Narrow with ' +
      '`query`. Each line carries a URI; read a full description with doc_read_file.',
    parameters: zodToOpenAISchema(lookupWardrobeToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const lookupWardrobeToolEffect: ToolEffectSpec = 'read';

export const lookupAtlasToolInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .optional()
    .describe("The thing's name or one of its aliases. Omit to list the names in a tier."),
  owner: z
    .string()
    .min(1)
    .optional()
    .describe('Whose Atlas: `character:Name`, `project:Name`, `group:Name` or `general`. Omit to look in every tier.'),
});

export type LookupAtlasInput = z.infer<typeof lookupAtlasToolInputSchema>;

export function validateLookupAtlasInput(input: unknown): boolean {
  return lookupAtlasToolInputSchema.safeParse(input).success;
}

export const lookupAtlasToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup_atlas',
    description:
      'Look up the Atlas (named things that are not people: places, vehicles, houses, devices, institutions). ' +
      'With `name`, the entry — aliases, graphic prompt, knowledge — and which tier holds it; without, the names ' +
      'filed in a tier (`owner`) or in every tier.',
    parameters: zodToOpenAISchema(lookupAtlasToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const lookupAtlasToolEffect: ToolEffectSpec = 'read';
