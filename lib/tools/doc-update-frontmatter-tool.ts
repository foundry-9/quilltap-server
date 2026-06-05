/**
 * @fileoverview Tool definition for updating YAML frontmatter in markdown files.
 * Supports merging updates with existing frontmatter or replacing it entirely.
 * Supports deletion by setting a key to null.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc-update-frontmatter tool's input.
 */
export const docUpdateFrontmatterToolInputSchema = z.object({
  scope: z
    .enum(['document_store', 'project', 'general'])
    .default('document_store')
    .describe('The file source scope. "document_store" operates on mounted document stores, "project" on project files, "general" on general files.')
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name. Required when scope is "document_store".')
    .optional(),
  path: z
    .string()
    .describe('Relative path to the markdown file within the selected scope.'),
  updates: z
    .record(z.string(), z.unknown())
    .describe('Key-value pairs to set or update. Use null as a value to delete a key. Can contain nested objects and arrays.'),
  replace_all: z
    .boolean()
    .default(false)
    .describe('If true, replace the entire frontmatter block with updates. If false (default), merge updates with existing frontmatter.')
    .optional(),
});

/**
 * Input parameters for the doc-update-frontmatter tool
 */
export type DocUpdateFrontmatterInput = z.infer<typeof docUpdateFrontmatterToolInputSchema>;

export const docUpdateFrontmatterToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_update_frontmatter',
    description:
      'Update or add YAML frontmatter properties in a markdown file. Merges updates with existing frontmatter by default. Use null as a value to delete a key. Creates a frontmatter block if one doesn\'t exist.',
    parameters: zodToOpenAISchema(docUpdateFrontmatterToolInputSchema),
  },
};

/**
 * Validates input for doc_update_frontmatter tool.
 */
export function validateDocUpdateFrontmatterInput(input: unknown): input is DocUpdateFrontmatterInput {
  return docUpdateFrontmatterToolInputSchema.safeParse(input).success;
}


export interface DocUpdateFrontmatterOutput {
  success: boolean;
  path: string;
  mtime: number;
}
