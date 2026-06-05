/**
 * @fileoverview Tool definition for creating folders in document stores, projects, and general files.
 * Creates parent directories as needed (like mkdir -p). Idempotent — succeeds if folder already exists.
 *
 * Scriptorium Phase 3.4
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_create_folder tool's input.
 */
export const docCreateFolderToolInputSchema = z.object({
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
    .describe('Relative path for the folder to create within the selected scope.'),
});

/**
 * Input parameters for the doc_create_folder tool
 */
export type DocCreateFolderInput = z.infer<typeof docCreateFolderToolInputSchema>;

/**
 * Validates input for doc_create_folder tool.
 */
export function validateDocCreateFolderInput(input: unknown): input is DocCreateFolderInput {
  return docCreateFolderToolInputSchema.safeParse(input).success;
}

export const docCreateFolderToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_create_folder',
    description:
      'Create a new folder in a document store, project files, or general files. Creates parent folders automatically. Succeeds silently if the folder already exists.',
    parameters: zodToOpenAISchema(docCreateFolderToolInputSchema),
  },
};

export interface DocCreateFolderOutput {
  success: boolean;
  path: string;
}
