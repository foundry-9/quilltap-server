/**
 * @fileoverview Tool definitions for the research kit's `lookup_group` and
 * `lookup_project` (docs/developer/features/research-kit.md §5.6). One call
 * each answers "who is in this group / project, and what is in its store".
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schemas are the single
 * source of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * the validators are one-line `safeParse(...).success` delegates. The logic
 * lives in `lib/research/records.ts`. Operator surface only.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const lookupGroupToolInputSchema = z.object({
  group: z.string().min(1).describe('The group: its name or id. Case-insensitive.'),
});

export type LookupGroupInput = z.infer<typeof lookupGroupToolInputSchema>;

export function validateLookupGroupInput(input: unknown): boolean {
  return lookupGroupToolInputSchema.safeParse(input).success;
}

export const lookupGroupToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup_group',
    description:
      'Look up a group in ONE call: its instructions, its document store with an outline, and every member as one ' +
      'line (name, title, the first sentence of their identity). Use it for any question about who is in a group ' +
      "or what its members do — do not read each member's vault.",
    parameters: zodToOpenAISchema(lookupGroupToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const lookupGroupToolEffect: ToolEffectSpec = 'read';

export const lookupProjectToolInputSchema = z.object({
  project: z.string().min(1).describe('The project: its name or id. Case-insensitive.'),
});

export type LookupProjectInput = z.infer<typeof lookupProjectToolInputSchema>;

export function validateLookupProjectInput(input: unknown): boolean {
  return lookupProjectToolInputSchema.safeParse(input).success;
}

export const lookupProjectToolDefinition = {
  type: 'function',
  function: {
    name: 'lookup_project',
    description:
      'Look up a project in ONE call: description and instructions, the roster, every linked store (official ' +
      'first) with an outline, the conversation count and the ten most recent conversations.',
    parameters: zodToOpenAISchema(lookupProjectToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const lookupProjectToolEffect: ToolEffectSpec = 'read';
