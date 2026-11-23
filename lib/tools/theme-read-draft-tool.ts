/**
 * @fileoverview Tool definition for Calliope's `theme_read_draft`: the theme
 * draft her conversation is about, rendered by `lib/themes/assist/render.ts`
 * (manifest, choices, primitives, the tokens it sets, the stylesheet, its
 * images and issues). Read-only; offered to Calliope's surface only (see
 * `lib/tools/handlers/theme-assist-handler.ts`).
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * `validateThemeReadDraftInput` is a one-line `safeParse(...).success`
 * delegate.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const themeReadDraftToolInputSchema = z.object({
  part: z
    .enum(['all', 'css'])
    .default('all')
    .describe(
      '"all" (the default) for the whole draft — name, choices, primitives, the tokens it sets, the stylesheet ' +
      '(clipped when long), images and issues; "css" for the stylesheet alone, in full up to a larger limit.'
    ),
});

export type ThemeReadDraftInput = z.infer<typeof themeReadDraftToolInputSchema>;

export function validateThemeReadDraftInput(input: unknown): boolean {
  return themeReadDraftToolInputSchema.safeParse(input).success;
}

export const themeReadDraftToolDefinition = {
  type: 'function',
  function: {
    name: 'theme_read_draft',
    description:
      'Read the theme draft this conversation is about, as it stands now: its name, the choices it makes, its ' +
      'primitives, every token it sets (light and dark), its stylesheet, its images and the issues the editor shows. ' +
      'Read it before proposing a change, and again after the author has kept one.',
    parameters: zodToOpenAISchema(themeReadDraftToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const themeReadDraftToolEffect: ToolEffectSpec = 'read';
