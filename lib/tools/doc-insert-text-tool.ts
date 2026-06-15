/**
 * @fileoverview Tool definition for inserting text at specific positions in files.
 * Position can be before or after unique anchor text, or at the start/end of a file.
 * The anchor text must be unique within the file if used.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Position specification for doc_insert_text
 */
const docInsertTextPositionSchema = z
  .object({
    before: z
      .string()
      .describe('Insert text before this anchor text (must be unique in file).')
      .optional(),
    after: z
      .string()
      .describe('Insert text after this anchor text (must be unique in file).')
      .optional(),
    at: z
      .enum(['start', 'end'])
      .describe('Insert at the start or end of the file.')
      .optional(),
  })
  .refine(
    (obj) => {
      const definedKeys = Object.keys(obj).filter((k) => obj[k as keyof typeof obj] !== undefined);
      return definedKeys.length === 1;
    },
    'Must specify exactly one of: before, after, or at'
  );

/**
 * Zod schema for the doc_insert_text tool's input.
 */
export const docInsertTextToolInputSchema = z.object({
  scope: z
    .enum(['document_store', 'project', 'general'])
    .default('document_store')
    .describe(
      'The file source scope. "document_store" operates on mounted document stores, "project" on project files, "general" on general files.'
    )
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name. Required when scope is "document_store". The reserved value "self" addresses your own character vault.')
    .optional(),
  path: z
    .string()
    .describe('Relative path to the file within the selected scope.'),
  position: docInsertTextPositionSchema.describe(
    'Insertion position. Must specify exactly one of: before (string), after (string), or at ("start"|"end").'
  ),
  content: z.string().describe('Text to insert at the specified position.'),
  normalize_diacritics: z
    .boolean()
    .default(true)
    .describe(
      'Normalize Unicode diacritics when matching anchor text (e.g., "Nimue" matches "Nimuë"). Default is true.'
    )
    .optional(),
});

/**
 * Input parameters for the doc_insert_text tool
 */
export type DocInsertTextInput = z.infer<typeof docInsertTextToolInputSchema>;

/**
 * Validates input for doc_insert_text tool.
 */
export function validateDocInsertTextInput(input: unknown): input is DocInsertTextInput {
  return docInsertTextToolInputSchema.safeParse(input).success;
}

export const docInsertTextToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_insert_text',
    description:
      'Insert text at a specific position in a file. Position can be before or after an anchor text (must be unique), or at the start/end of the file.',
    parameters: zodToOpenAISchema(docInsertTextToolInputSchema),
  },
};

export interface DocInsertTextOutput {
  success: boolean;
  path: string;
  mtime: number;
  line_number: number;
}
