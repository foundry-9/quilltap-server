/**
 * @fileoverview Tool definition for deleting files from document stores, projects, and general files.
 * Permanently deletes the file (no trash/recycle bin).
 *
 * Scriptorium Phase 3.4
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_delete_file tool's input.
 */
export const docDeleteFileToolInputSchema = z.object({
  scope: z
    .enum(['document_store', 'project', 'general'])
    .default('document_store')
    .describe(
      'The file scope. "document_store" for mounted document stores, "project" for project files, "general" for general files.'
    )
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name. Required when scope is "document_store".')
    .optional(),
  path: z
    .string()
    .describe('Relative path to the file to delete within the selected scope.'),
});

/**
 * Input parameters for the doc_delete_file tool
 */
export type DocDeleteFileInput = z.infer<typeof docDeleteFileToolInputSchema>;

/**
 * Validates input for doc_delete_file tool.
 */
export function validateDocDeleteFileInput(input: unknown): input is DocDeleteFileInput {
  return docDeleteFileToolInputSchema.safeParse(input).success;
}

export const docDeleteFileToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_delete_file',
    description:
      'Permanently delete a file from a document store, project files, or general files. This action cannot be undone — confirm intent before calling.',
    parameters: zodToOpenAISchema(docDeleteFileToolInputSchema),
  },
};

export interface DocDeleteFileOutput {
  success: boolean;
  path: string;
}
