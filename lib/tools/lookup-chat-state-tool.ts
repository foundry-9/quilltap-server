/**
 * @fileoverview Tool definition for the research kit's `lookup_chat_state` —
 * a conversation's live state (who is present, what each carries and wears,
 * the scene tracker's note) from the chat's own records. Logic in
 * `lib/research/chat-state.ts`. Operator surface only.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth: `parameters` is derived via `zodToOpenAISchema(...)` and the
 * validator is a one-line `safeParse(...).success` delegate.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const lookupChatStateToolInputSchema = z.object({
  conversation: z
    .string()
    .min(1)
    .optional()
    .describe('A conversation by id or exact title. Omit for the conversation you were asked from.'),
});

export type LookupChatStateInput = z.infer<typeof lookupChatStateToolInputSchema>;

export function validateLookupChatStateInput(input: unknown): boolean {
  return lookupChatStateToolInputSchema.safeParse(input).success;
}

export const lookupChatStateToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup_chat_state',
    description:
      "A conversation's live state RIGHT NOW, in ONE call: every seat (present or not), what each is carrying " +
      '(equipped objects) and wearing in that chat, the scene tracker\'s location and per-person action, and ' +
      'the Concierge posture. Use it for "what does X have / hold / wear now", "who is here". An object\'s own ' +
      "file never says whether it is carried in a chat — this does.",
    parameters: zodToOpenAISchema(lookupChatStateToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const lookupChatStateToolEffect: ToolEffectSpec = 'read';
