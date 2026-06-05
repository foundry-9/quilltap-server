/**
 * @fileoverview Tool definition for replacing content under specific headings in markdown files.
 * By default preserves subheadings; can optionally replace entire section including subheadings.
 * Supports disambiguation by heading level when heading text appears multiple times.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc-update-heading tool's input.
 */
export const docUpdateHeadingToolInputSchema = z.object({
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
  heading: z
    .string()
    .describe('Heading text without # markers. For example, "Character Backstory" for the heading "## Character Backstory".'),
  content: z
    .string()
    .describe('New content to place under the heading. Can be empty to clear the section.'),
  level: z
    .number()
    .int()
    .min(1)
    .max(6)
    .describe('Heading level (1-6) if the heading text is ambiguous. Use this to disambiguate when the same heading text appears at different levels.')
    .optional(),
  preserve_subheadings: z
    .boolean()
    .default(true)
    .describe('If true (default), only replace content before the first subheading. If false, replace the entire section including subheadings.')
    .optional(),
});

/**
 * Input parameters for the doc-update-heading tool
 */
export type DocUpdateHeadingInput = z.infer<typeof docUpdateHeadingToolInputSchema>;

export const docUpdateHeadingToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_update_heading',
    description:
      'Replace all content under a specific heading in a markdown file. By default, preserves subheadings and only replaces content before the first subheading. Set preserve_subheadings to false to replace the entire section including subheadings.',
    parameters: zodToOpenAISchema(docUpdateHeadingToolInputSchema),
  },
};

/**
 * Validates input for doc_update_heading tool.
 */
export function validateDocUpdateHeadingInput(input: unknown): input is DocUpdateHeadingInput {
  return docUpdateHeadingToolInputSchema.safeParse(input).success;
}


export interface DocUpdateHeadingOutput {
  success: boolean;
  path: string;
  mtime: number;
}
