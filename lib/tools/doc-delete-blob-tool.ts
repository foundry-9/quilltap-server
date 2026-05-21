/**
 * @fileoverview Tool definition for deleting a binary blob asset from a document store.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_delete_blob tool's input.
 */
export const docDeleteBlobToolInputSchema = z.object({
  mount_point: z.string().describe('Mount point name or ID holding the blob.'),
  path: z.string().describe('Relative path to the blob within the mount point.'),
});

/**
 * Input parameters for the doc_delete_blob tool
 */
export type DocDeleteBlobInput = z.infer<typeof docDeleteBlobToolInputSchema>;

/**
 * Validates input for doc_delete_blob tool.
 */
export function validateDocDeleteBlobInput(input: unknown): input is DocDeleteBlobInput {
  return docDeleteBlobToolInputSchema.safeParse(input).success;
}

export const docDeleteBlobToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_delete_blob',
    description:
      'Delete a binary asset from a document store. Markdown references to the deleted blob will 404 until re-uploaded.',
    parameters: zodToOpenAISchema(docDeleteBlobToolInputSchema),
  },
};

export interface DocDeleteBlobOutput {
  success: boolean;
  mount_point: string;
  relative_path: string;
}
