/**
 * @fileoverview Tool definition for reading a binary blob asset's metadata
 * (and optionally its bytes as base64) from a document store.
 */

export const docReadBlobTool = {
  type: 'function',
  function: {
    name: 'doc_read_blob',
    description:
      'Read metadata (and optionally bytes) for a binary asset previously uploaded to a document store via doc_write_blob.',
    parameters: {
      type: 'object',
      properties: {
        mount_point: {
          type: 'string',
          description: 'Mount point name or ID holding the blob.',
        },
        path: {
          type: 'string',
          description: 'Relative path to the blob within the mount point (e.g. images/avatar.webp).',
        },
        include_bytes: {
          type: 'boolean',
          default: false,
          description:
            'When true, returns the blob bytes as base64 alongside its metadata. Default false keeps responses compact.',
        },
      },
      required: ['mount_point', 'path'],
    },
  },
};

export function validateDocReadBlobInput(input: unknown): input is DocReadBlobInput {
  if (typeof input !== 'object' || input === null) return false;
  const o = input as Record<string, unknown>;
  return (
    typeof o.mount_point === 'string' &&
    typeof o.path === 'string' &&
    (o.include_bytes === undefined || typeof o.include_bytes === 'boolean')
  );
}

export interface DocReadBlobInput {
  mount_point: string;
  path: string;
  include_bytes?: boolean;
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
