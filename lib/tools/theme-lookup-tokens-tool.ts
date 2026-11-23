/**
 * @fileoverview Tool definition for Calliope's `theme_lookup_tokens`: registry
 * tokens by words, exact name, group or type, each with the draft's value in
 * force in light and dark (`lookupTokens` / `renderTokenLookup`,
 * `lib/themes/assist/render.ts`). Read-only; Calliope's surface only.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * `validateThemeLookupTokensInput` is a one-line `safeParse(...).success`
 * delegate.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { THEME_TOKENS } from '@/lib/themes/engine/client';

/** Every token type the registry uses, in registry order. */
const TOKEN_TYPES = [...new Set(THEME_TOKENS.map((t) => t.type))] as [string, ...string[]];

export const themeLookupTokensToolInputSchema = z
  .object({
    query: z
      .string()
      .max(200)
      .optional()
      .describe('Words matched against a token\'s label, name and description, e.g. "sidebar background" or "focus ring".'),
    names: z
      .array(z.string().regex(/^--[a-z0-9-]+$/))
      .max(40)
      .optional()
      .describe('Exact registry names, e.g. ["--theme-primary", "--qt-chat-user-bg"].'),
    group: z
      .string()
      .max(80)
      .optional()
      .describe('A token group id or a word in its label, e.g. "colors", "chat" or "typography".'),
    type: z.enum(TOKEN_TYPES).optional().describe('Only tokens of this type.'),
    setOnly: z.boolean().optional().describe('Only tokens the draft sets itself.'),
  })
  .refine((q) => !!(q.query?.trim() || q.names?.length || q.group?.trim() || q.type || q.setOnly), {
    message: 'Give words, names, a group, a type or setOnly.',
  });

export type ThemeLookupTokensInput = z.infer<typeof themeLookupTokensToolInputSchema>;

export function validateThemeLookupTokensInput(input: unknown): boolean {
  return themeLookupTokensToolInputSchema.safeParse(input).success;
}

export const themeLookupTokensToolDefinition = {
  type: 'function',
  function: {
    name: 'theme_lookup_tokens',
    description:
      'Find theme tokens in the registry — by words, exact names, group or type — each with its type, its ' +
      'description and the value in force in this draft in light and dark (and whether the draft sets it, a ' +
      'choice sets it, or it is the default). Look a token up before you propose to set it.',
    parameters: zodToOpenAISchema(themeLookupTokensToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const themeLookupTokensToolEffect: ToolEffectSpec = 'read';
