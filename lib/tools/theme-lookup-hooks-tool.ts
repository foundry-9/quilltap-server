/**
 * @fileoverview Tool definition for Calliope's `theme_lookup_hooks`: hooks in
 * the theme hook catalogue by words, class or surface, with their variants,
 * states and what the app's stylesheets set on them, joined to the draft's
 * values (`lookupHooks` / `renderHookLookup`, `lib/themes/assist/render.ts`).
 * Read-only; Calliope's surface only.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * `validateThemeLookupHooksInput` is a one-line `safeParse(...).success`
 * delegate.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { HOOK_SURFACES } from '@/lib/themes/hooks';

export const themeLookupHooksToolInputSchema = z
  .object({
    query: z
      .string()
      .max(200)
      .optional()
      .describe('Words matched against a hook\'s label, class and description, e.g. "message bubble" or "sidebar".'),
    classes: z
      .array(z.string().regex(/^\.?qt-[a-z0-9-]+$/))
      .max(20)
      .optional()
      .describe('Exact hook classes, e.g. ["qt-chat-message"].'),
    surface: z
      .enum(HOOK_SURFACES as [string, ...string[]])
      .optional()
      .describe('Only hooks on this part of the app.'),
  })
  .refine((q) => !!(q.query?.trim() || q.classes?.length || q.surface), {
    message: 'Give words, classes or a surface.',
  });

export type ThemeLookupHooksInput = z.infer<typeof themeLookupHooksToolInputSchema>;

export function validateThemeLookupHooksInput(input: unknown): boolean {
  return themeLookupHooksToolInputSchema.safeParse(input).success;
}

export const themeLookupHooksToolDefinition = {
  type: 'function',
  function: {
    name: 'theme_lookup_hooks',
    description:
      'Find the catalogued hooks a stylesheet may select — by words, class or surface — with the variants and ' +
      'states each carries, the hooks it sits inside, and what the app\'s own stylesheets set on it: which ' +
      'property reads which token, with this draft\'s value. Look a hook up before writing CSS for it; when a ' +
      'token already drives the property, set the token instead.',
    parameters: zodToOpenAISchema(themeLookupHooksToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const themeLookupHooksToolEffect: ToolEffectSpec = 'read';
