/**
 * @fileoverview Tool definition for the research kit's `lookup_conversations`
 * (docs/developer/features/research-kit.md §5.5). Finds conversations, not
 * lines: by words in the title or summary, who took part and when — or one
 * conversation in full (its summary and an outline).
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * `validateLookupConversationsInput` is a one-line `safeParse(...).success`
 * delegate. The logic lives in `lib/research/records.ts`. Operator surface only.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const lookupConversationsToolInputSchema = z.object({
  query: z.string().min(1).optional().describe("Words in the conversation's title or summary."),
  character: z
    .string()
    .min(1)
    .optional()
    .describe('Only conversations this character took part in (name, alias or id).'),
  since: z.string().min(1).optional().describe('Only conversations active on or after this date (YYYY-MM-DD).'),
  until: z.string().min(1).optional().describe('Only conversations begun on or before this date (YYYY-MM-DD).'),
  conversation: z
    .string()
    .min(1)
    .optional()
    .describe('One conversation by id or exact title: returns its whole summary and an outline.'),
  limit: z.number().int().min(1).max(30).optional().describe('Conversations to return (default 10, at most 30).'),
});

export type LookupConversationsInput = z.infer<typeof lookupConversationsToolInputSchema>;

export function validateLookupConversationsInput(input: unknown): boolean {
  return lookupConversationsToolInputSchema.safeParse(input).success;
}

export const lookupConversationsToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup_conversations',
    description:
      'Find which conversation: by words in the title or summary (`query`), who took part (`character`) and a ' +
      'date window (`since` / `until`). Each hit gives id, title, first and last dates, participants, line count ' +
      'and the start of its summary. With `conversation`, that one in full: summary and an outline. Then ' +
      'read_messages on the one that fits; do not read conversations one by one to identify them.',
    parameters: zodToOpenAISchema(lookupConversationsToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const lookupConversationsToolEffect: ToolEffectSpec = 'read';
