/**
 * @fileoverview Tool definition for the research kit's `list_documents`
 * (docs/developer/features/research-kit.md §5.4). Shows what a store or
 * folder holds without flooding the context — big and picture folders are
 * one line each — or, with no `store`, the stores in reach.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * `validateListDocumentsInput` is a one-line `safeParse(...).success`
 * delegate. The logic lives in `lib/research/documents.ts`.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const listDocumentsToolInputSchema = z.object({
  store: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The store to list: its name, or `character:Name`, `project:Name`, `group:Name`, `general`. ' +
        'Omit for the list of every store in reach.'
    ),
  folder: z.string().min(1).optional().describe('List only this folder of the store, e.g. "Wardrobe".'),
  depth: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('How many folder levels to open (default 2). A folder of more than 25 files is shown as one line.'),
});

export type ListDocumentsInput = z.infer<typeof listDocumentsToolInputSchema>;

export function validateListDocumentsInput(input: unknown): boolean {
  return listDocumentsToolInputSchema.safeParse(input).success;
}

export const listDocumentsToolDefinition = {
  type: 'function',
  function: {
    name: 'list_documents',
    description:
      'List what a document store or folder holds, compactly: folders of more than 25 files and picture folders ' +
      'are one line each (count and newest file). With no `store`, lists every store in reach with its owner, ' +
      'file count and last change. To find a file by what it says or what it is called, use find_documents.',
    parameters: zodToOpenAISchema(listDocumentsToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const listDocumentsToolEffect: ToolEffectSpec = 'read';
