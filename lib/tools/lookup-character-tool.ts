/**
 * @fileoverview Tool definition for the Brahma Console's `lookup_character`
 * shortcut. One call answers "who is X?": the character's core fields (read
 * through the ordinary hydrated repository, so the vault is never walked by
 * hand), their physical descriptions, how many memories they hold, and the
 * conversations they have taken part in. Read-only; offered on the operator
 * surface only (see `lib/tools/handlers/brahma-lookup-handler.ts`).
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * `validateLookupCharacterInput` is a one-line `safeParse(...).success`
 * delegate.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const lookupCharacterToolInputSchema = z.object({
  character: z
    .string()
    .min(1)
    .describe(
      "The character to look up: their name, one of their aliases, or their id. Case-insensitive. " +
      'If the name is ambiguous the tool lists the candidates instead.'
    ),
});

export type LookupCharacterInput = z.infer<typeof lookupCharacterToolInputSchema>;

export function validateLookupCharacterInput(input: unknown): boolean {
  return lookupCharacterToolInputSchema.safeParse(input).success;
}

export const lookupCharacterToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup_character',
    description:
      "Look up a character in ONE call: id, name, aliases, pronouns, title, their core files " +
      '(identity, description, personality, manifesto), physical descriptions, how many memories ' +
      'they hold, and their conversation count with the most recent conversations (id, title, ' +
      'dates). Use this FIRST for any question about a character — it replaces several run_sql ' +
      'calls and the vault lookup.',
    parameters: zodToOpenAISchema(lookupCharacterToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const lookupCharacterToolEffect: ToolEffectSpec = 'read';
