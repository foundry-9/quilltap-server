/**
 * @fileoverview Tool definition for the Brahma Console's `lookup_memories`
 * shortcut: a relevance search over one character's Commonplace Book — or every
 * character's — for the operator. It runs the same search a character's own
 * `search` tool runs, but as **inspection**: nothing is stamped as recalled, so
 * a lookup never changes what a character will remember next. Read-only;
 * offered on the operator surface only.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

export const lookupMemoriesToolInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'What to look for, in plain words (e.g. "age birthday born", "first met Charlie"). ' +
      'Matched by meaning, with a boost for exact wording.'
    ),
  character: z
    .string()
    .describe(
      'Whose memories to search — the character who HOLDS them (name, alias or id). Omit to ' +
      'search every character and merge the best hits.'
    )
    .optional(),
  about: z
    .string()
    .describe(
      'Only memories ABOUT this character (name, alias or id). E.g. character "Friday", about ' +
      '"Laura" = what Friday remembers about Laura; character "Laura", about "Laura" = what ' +
      'Laura knows about herself.'
    )
    .optional(),
  since: z
    .string()
    .describe('Only memories of events on or after this date (YYYY-MM-DD or ISO timestamp).')
    .optional(),
  until: z
    .string()
    .describe('Only memories of events on or before this date (YYYY-MM-DD or ISO timestamp).')
    .optional(),
  limit: llmNumber(
    z.number().int().min(1).max(30).describe('How many memories to return (default 10, max 30).')
  )
    .default(10)
    .optional(),
});

export type LookupMemoriesInput = z.infer<typeof lookupMemoriesToolInputSchema>;

export function validateLookupMemoriesInput(input: unknown): boolean {
  return lookupMemoriesToolInputSchema.safeParse(input).success;
}

export const lookupMemoriesToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup_memories',
    description:
      "Search characters' memories by meaning. Returns each memory's text, who holds it, who it " +
      'is about, when it happened, its importance, and the conversation it came from (id and ' +
      'title). Inspection only — it does not count as the character remembering anything. ' +
      'Prefer this over querying the memories table with run_sql.',
    parameters: zodToOpenAISchema(lookupMemoriesToolInputSchema),
  },
};

/** Reads, changes nothing (no access stamping). */
export const lookupMemoriesToolEffect: ToolEffectSpec = 'read';
