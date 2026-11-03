/**
 * @fileoverview Tool definition for the Brahma Console's `lookup_messages`
 * shortcut: a full-text search over every conversation's messages through the
 * FTS5 index (the same one the global search bar uses), returning each hit
 * with its conversation's id, title and date and the speaker's name. It
 * replaces the slow `qt_text(content) LIKE …` scan a model would otherwise
 * write. Read-only; offered on the operator surface only.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

export const lookupMessagesToolInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Words to find. Whole words and word prefixes match, case- and accent-insensitive; every ' +
      'word must appear in the message. Put a phrase in double quotes to require it verbatim. ' +
      'Keep it to the 1–3 most distinctive words.'
    ),
  character: z
    .string()
    .describe('Only conversations this character took part in (name, alias or id).')
    .optional(),
  speaker: z
    .string()
    .describe('Only lines spoken by this character (name, alias or id).')
    .optional(),
  since: z
    .string()
    .describe('Only messages written on or after this date (YYYY-MM-DD or ISO timestamp).')
    .optional(),
  until: z
    .string()
    .describe('Only messages written on or before this date (YYYY-MM-DD or ISO timestamp).')
    .optional(),
  limit: llmNumber(
    z.number().int().min(1).max(30).describe('How many hits to return, newest first (default 10, max 30).')
  )
    .default(10)
    .optional(),
});

export type LookupMessagesInput = z.infer<typeof lookupMessagesToolInputSchema>;

export function validateLookupMessagesInput(input: unknown): boolean {
  return lookupMessagesToolInputSchema.safeParse(input).success;
}

export const lookupMessagesToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup_messages',
    description:
      'Full-text search across every conversation. Each hit gives the conversation (id, title, ' +
      'date), the message id, when it was written, who said it, and a snippet around the match. ' +
      'Use it to answer "in which conversation did X happen?", then read_messages to see the ' +
      'surrounding lines. Much faster than searching chat_messages with run_sql.',
    parameters: zodToOpenAISchema(lookupMessagesToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const lookupMessagesToolEffect: ToolEffectSpec = 'read';
