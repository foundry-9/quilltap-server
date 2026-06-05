/**
 * @fileoverview Tool definition for opening a document in the split-panel Document Mode editor.
 * This is a UI tool — it opens a document alongside the chat for collaborative editing.
 * Scriptorium Phase 3.5.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc-open-document tool's input.
 */
export const docOpenDocumentToolInputSchema = z.object({
  path: z
    .string()
    .describe('Relative path to the file to open. Omit to create a new blank document.')
    .optional(),
  title: z
    .string()
    .describe('Display title for new blank documents. Ignored if path is provided.')
    .optional(),
  scope: z
    .enum(['document_store', 'project', 'general'])
    .default('project')
    .describe('The file source scope. Only used when path is provided.')
    .optional(),
  mount_point: z
    .string()
    .describe('Mount point name. Required when scope is "document_store".')
    .optional(),
  mode: z
    .enum(['split', 'focus'])
    .default('split')
    .describe('Layout mode. "split" shows chat and document side by side, "focus" maximizes the document editor.')
    .optional(),
});

/**
 * Input parameters for the doc-open-document tool
 */
export type DocOpenDocumentInput = z.infer<typeof docOpenDocumentToolInputSchema>;

export const docOpenDocumentToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_open_document',
    description:
      'Open a document in the split-panel Document Mode editor alongside the chat. Creates a new blank document if no path is provided, or opens an existing file. The user will see the document in an editor pane next to the chat.',
    parameters: zodToOpenAISchema(docOpenDocumentToolInputSchema),
  },
};

/**
 * Validates input for doc_open_document tool.
 */
export function validateDocOpenDocumentInput(input: unknown): input is DocOpenDocumentInput {
  return docOpenDocumentToolInputSchema.safeParse(input).success;
}


export interface DocOpenDocumentOutput {
  success: boolean;
  filePath: string;
  scope: string;
  mountPoint?: string;
  displayTitle: string;
  mode: 'split' | 'focus';
  isNew: boolean;
  mtime?: number;
}
