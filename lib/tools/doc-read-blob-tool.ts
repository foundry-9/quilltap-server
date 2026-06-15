/**
 * @fileoverview Tool definition for reading a binary blob asset's metadata
 * (and optionally its bytes as base64) from a document store.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc-read-blob tool's input.
 */
export const docReadBlobToolInputSchema = z.object({
  mount_point: z
    .string()
    .describe('Mount point name or ID holding the blob. Pass "self" for your own character vault.'),
  path: z
    .string()
    .describe('Relative path to the blob within the mount point (e.g. images/avatar.webp).'),
  include_bytes: z
    .boolean()
    .default(false)
    .describe('When true, returns the blob bytes as base64 alongside its metadata. Default false keeps responses compact.')
    .optional(),
});

/**
 * Input parameters for the doc-read-blob tool
 */
export type DocReadBlobInput = z.infer<typeof docReadBlobToolInputSchema>;

export const docReadBlobToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_read_blob',
    description:
      'Read metadata (and optionally bytes) for a binary asset previously uploaded to a document store via doc_write_blob.',
    parameters: zodToOpenAISchema(docReadBlobToolInputSchema),
  },
};

export function validateDocReadBlobInput(input: unknown): input is DocReadBlobInput {
  return docReadBlobToolInputSchema.safeParse(input).success;
}


export interface DocReadBlobOutput {
  mount_point: string;
  relative_path: string;
  original_filename: string;
  original_mime_type: string;
  stored_mime_type: string;
  size_bytes: number;
  sha256: string;
  description: string;
  data_base64?: string;
}
