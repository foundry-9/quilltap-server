/**
 * @fileoverview Tool definition for moving or renaming files in document stores, projects, and general files.
 * Unified move/rename operation. Does not overwrite existing files.
 *
 * Scriptorium Phase 3.4
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_move_file tool's input.
 */
export const docMoveFileToolInputSchema = z.object({
  scope: z
    .enum(['document_store', 'project', 'general'])
    .default('document_store')
    .describe(
      'The file scope. "document_store" for mounted document stores, "project" for project files, "general" for general files.'
    )
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name. Required when scope is "document_store". The reserved value "self" addresses your own character vault.')
    .optional(),
  path: z
    .string()
    .describe('Current relative path to the file within the selected scope.'),
  new_path: z
    .string()
    .describe('Destination relative path for the file. Parent directories are created automatically.'),
});

/**
 * Input parameters for the doc_move_file tool
 */
export type DocMoveFileInput = z.infer<typeof docMoveFileToolInputSchema>;

/**
 * Validates input for doc_move_file tool.
 */
export function validateDocMoveFileInput(input: unknown): input is DocMoveFileInput {
  return docMoveFileToolInputSchema.safeParse(input).success;
}

export const docMoveFileToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_move_file',
    description:
      'Move or rename a file in a document store, project files, or general files. If new_path is in a different directory, moves the file. If in the same directory, renames it. Will not overwrite an existing file at the destination.',
    parameters: zodToOpenAISchema(docMoveFileToolInputSchema),
  },
};

export interface DocMoveFileOutput {
  success: boolean;
  old_path: string;
  new_path: string;
}
