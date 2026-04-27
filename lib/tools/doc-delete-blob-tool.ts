/**
 * @fileoverview Tool definition for deleting a binary blob asset from a document store.
 */

export const docDeleteBlobTool = {
  type: 'function',
  function: {
    name: 'doc_delete_blob',
    description:
      'Delete a binary asset from a document store. Markdown references to the deleted blob will 404 until re-uploaded.',
    parameters: {
      type: 'object',
      properties: {
        mount_point: {
          type: 'string',
          description: 'Mount point name or ID holding the blob.',
        },
        path: {
          type: 'string',
          description: 'Relative path to the blob within the mount point.',
        },
      },
      required: ['mount_point', 'path'],
    },
  },
};

export function validateDocDeleteBlobInput(input: unknown): input is DocDeleteBlobInput {
  if (typeof input !== 'object' || input === null) return false;
  const o = input as Record<string, unknown>;
  return typeof o.mount_point === 'string' && typeof o.path === 'string';
}

export interface DocDeleteBlobInput {
  mount_point: string;
  path: string;
}

export interface DocDeleteBlobOutput {
  success: boolean;
  mount_point: string;
  relative_path: string;
}
