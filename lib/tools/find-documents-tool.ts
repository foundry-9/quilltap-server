/**
 * @fileoverview Tool definition for the research kit's `find_documents`
 * (docs/developer/features/research-kit.md §5.3). Finds files across every
 * store in reach by what they say, what they are called, or both: one ranked
 * entry per distinct file, with up to three matching lines.
 *
 * Per the CLAUDE.md tool chokepoint rule, the Zod schema is the single source
 * of truth: `parameters` is derived via `zodToOpenAISchema(...)` and
 * `validateFindDocumentsInput` is a one-line `safeParse(...).success`
 * delegate. The logic lives in `lib/research/documents.ts` (handler:
 * `lib/tools/handlers/research-kit-handler.ts`).
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/** The `store` argument every research document tool shares. */
export const researchStoreArgument = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Narrow to one store: its name, or `character:Name`, `project:Name`, `group:Name`, `general`. ' +
      'Omit to search everything in reach. The shorthand is for this argument only: a qtap:// address ' +
      'names the store itself (as results print it), never `character:Name`.'
  );

export const findDocumentsToolInputSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Words to find in the content; put a phrase in "double quotes" to find it whole. Every word or phrase ' +
          'must appear. Case, accents and curly quotes are ignored.'
      ),
    name: z
      .string()
      .min(1)
      .optional()
      .describe("Words that must appear in the file's path or name, e.g. \"blazer\" or \"chapter 9\"."),
    store: researchStoreArgument,
    folder: z
      .string()
      .min(1)
      .optional()
      .describe('Narrow to a folder, e.g. "Wardrobe" or "Conversation Summaries".'),
    modified_since: z
      .string()
      .min(1)
      .optional()
      .describe('Only files changed on or after this date (YYYY-MM-DD).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe('Files to return (default 10, at most 30).'),
  })
  .refine((v) => !!(v.text?.trim() || v.name?.trim()), { message: 'Give `text`, `name`, or both.' });

export type FindDocumentsInput = z.infer<typeof findDocumentsToolInputSchema>;

export function validateFindDocumentsInput(input: unknown): boolean {
  return findDocumentsToolInputSchema.safeParse(input).success;
}

export const findDocumentsToolDefinition = {
  type: 'function',
  function: {
    name: 'find_documents',
    description:
      'Find files in the document stores by what they say (`text`), what they are called (`name`), or both. ' +
      'Searches EVERY store in reach unless you narrow it with `store` or `folder`; one ranked entry per file with ' +
      'its store, path, URI, date and matching lines. Use it before doc_read_file to find the right file. ' +
      'If it finds nothing, the text is not in any store; do not retry with small spelling changes.',
    parameters: zodToOpenAISchema(findDocumentsToolInputSchema),
  },
};

/** Reads, changes nothing. */
export const findDocumentsToolEffect: ToolEffectSpec = 'read';
