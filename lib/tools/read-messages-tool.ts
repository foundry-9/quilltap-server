/**
 * @fileoverview Tool definition for the Brahma Console's `read_messages`
 * shortcut: a bounded, speaker-labelled slice of one conversation — either the
 * lines around a message (from `lookup_messages`) or a window by position.
 * Read-only; offered on the operator surface only.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

export const readMessagesToolInputSchema = z.object({
  conversation_id: z.string().min(1).describe('The conversation (chat) id.'),
  around_message_id: z
    .string()
    .describe('Centre the slice on this message (e.g. a lookup_messages hit). Omit to read by position.')
    .optional(),
  before: llmNumber(
    z.number().int().min(0).max(10).describe('With around_message_id: how many lines before it (default 3).')
  )
    .default(3)
    .optional(),
  after: llmNumber(
    z.number().int().min(0).max(10).describe('With around_message_id: how many lines after it (default 3).')
  )
    .default(3)
    .optional(),
  offset: llmNumber(
    z
      .number()
      .int()
      .describe(
        'Without around_message_id: position of the first line (0 = the opening line; negative ' +
        'counts from the end, so -5 = the last five). Default 0.'
      )
  )
    .default(0)
    .optional(),
  count: llmNumber(
    z.number().int().min(1).max(20).describe('Without around_message_id: how many lines (default 10, max 20).')
  )
    .default(10)
    .optional(),
});

export type ReadMessagesInput = z.infer<typeof readMessagesToolInputSchema>;

export function validateReadMessagesInput(input: unknown): boolean {
  return readMessagesToolInputSchema.safeParse(input).success;
}

export const readMessagesToolDefinition = {
  type: 'function',
  function: {
    name: 'read_messages',
    description:
      "Read a few lines of one conversation, labelled by speaker and timestamp, with the " +
      "conversation's title, dates and cast. Centre on a message id from lookup_messages, or " +
      'read by position (the opening, or the last few lines). Only spoken lines are returned — ' +
      'no system notices.',
    parameters: zodToOpenAISchema(readMessagesToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const readMessagesToolEffect: ToolEffectSpec = 'read';
