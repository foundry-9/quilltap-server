/**
 * @fileoverview Tool definition for Calliope's `theme_check_contrast`: the
 * WCAG contrast of a registry pair, or of two colours (tokens or literals),
 * against the draft in light and dark (`checkDraftContrast` /
 * `renderContrastCheck`, `lib/themes/assist/render.ts`, measured by the
 * engine's `checkContrast`). Read-only; Calliope's surface only.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * `validateThemeCheckContrastInput` is a one-line `safeParse(...).success`
 * delegate.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

const colour = (description: string) => z.string().trim().min(1).max(200).describe(description);

export const themeCheckContrastToolInputSchema = z
  .object({
    pair: z
      .string()
      .max(120)
      .optional()
      .describe('A registry contrast pair by id: the two token names without "--", joined by "/", e.g. "theme-foreground/theme-background".'),
    foreground: colour('The colour in front: a token ("--theme-primary-foreground") or a colour ("#fdf6e3", "oklch(0.3 0.05 260)").').optional(),
    background: colour('The colour behind it, in the same forms.').optional(),
    kind: z
      .enum(['text', 'non-text'])
      .optional()
      .describe('"text" needs 4.5:1, "non-text" (focus rings, borders that carry meaning) 3:1. Defaults to the registry pair\'s kind, else text.'),
  })
  .refine((q) => !!q.pair?.trim() || (!!q.foreground && !!q.background), {
    message: 'Name a pair, or both a foreground and a background.',
  });

export type ThemeCheckContrastInput = z.infer<typeof themeCheckContrastToolInputSchema>;

export function validateThemeCheckContrastInput(input: unknown): boolean {
  return themeCheckContrastToolInputSchema.safeParse(input).success;
}

export const themeCheckContrastToolDefinition = {
  type: 'function',
  function: {
    name: 'theme_check_contrast',
    description:
      'Measure contrast against this draft, in light and in dark: a registry pair by id, or any two colours, each ' +
      'a token or a colour value. Says the ratio, the threshold and whether it passes. Check a colour before you ' +
      'propose it, so the proposal keeps every pair passing.',
    parameters: zodToOpenAISchema(themeCheckContrastToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const themeCheckContrastToolEffect: ToolEffectSpec = 'read';
