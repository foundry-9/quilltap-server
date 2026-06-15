/**
 * @fileoverview Tool definition for listing binary blob assets in a document store.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_list_blobs tool's input.
 */
export const docListBlobsToolInputSchema = z.object({
  mount_point: z.string().describe('Mount point name or ID to enumerate blobs for. Pass "self" for your own character vault.'),
  folder: z
    .string()
    .describe('Optional folder prefix to filter results (e.g. "images").')
    .optional(),
});

/**
 * Input parameters for the doc_list_blobs tool
 */
export type DocListBlobsInput = z.infer<typeof docListBlobsToolInputSchema>;

/**
 * Validates input for doc_list_blobs tool.
 */
export function validateDocListBlobsInput(input: unknown): input is DocListBlobsInput {
  return docListBlobsToolInputSchema.safeParse(input).success;
}

export const docListBlobsToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_list_blobs',
    description:
      'List binary assets (images, etc.) stored in a document store. Returns metadata only — use doc_read_blob with include_bytes for the raw bytes.',
    parameters: zodToOpenAISchema(docListBlobsToolInputSchema),
  },
};

export interface DocBlobSummary {
  relative_path: string;
  original_filename: string;
  original_mime_type: string;
  stored_mime_type: string;
  size_bytes: number;
  description: string;
}

export interface DocListBlobsOutput {
  mount_point: string;
  blobs: DocBlobSummary[];
  total: number;
}
