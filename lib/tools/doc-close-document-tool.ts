/**
 * @fileoverview Tool definition for closing the Document Mode editor pane.
 * This is a UI tool — it closes the document pane and returns to the normal chat layout.
 * Scriptorium Phase 3.5.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_close_document tool's input.
 */
export const docCloseDocumentToolInputSchema = z.object({
  reason: z
    .string()
    .describe('Optional reason for closing the document. Shown to the user as a system note.')
    .optional(),
});

/**
 * Input parameters for the doc_close_document tool
 */
export type DocCloseDocumentInput = z.infer<typeof docCloseDocumentToolInputSchema>;

/**
 * Validates input for doc_close_document tool.
 */
export function validateDocCloseDocumentInput(input: unknown): input is DocCloseDocumentInput {
  return docCloseDocumentToolInputSchema.safeParse(input).success;
}

export const docCloseDocumentToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_close_document',
    description:
      'Close the Document Mode editor pane and return to the normal chat layout. Any pending changes are saved automatically before closing. The document state is cached for the session — reopening the same document does not require a full reload.',
    parameters: zodToOpenAISchema(docCloseDocumentToolInputSchema),
  },
};

export interface DocCloseDocumentOutput {
  success: boolean;
  message: string;
}
