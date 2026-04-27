/**
 * @fileoverview Tool definition for listing binary blob assets in a document store.
 */

export const docListBlobsTool = {
  type: 'function',
  function: {
    name: 'doc_list_blobs',
    description:
      'List binary assets (images, etc.) stored in a document store. Returns metadata only — use doc_read_blob with include_bytes for the raw bytes.',
    parameters: {
      type: 'object',
      properties: {
        mount_point: {
          type: 'string',
          description: 'Mount point name or ID to enumerate blobs for.',
        },
        folder: {
          type: 'string',
          description: 'Optional folder prefix to filter results (e.g. "images").',
        },
      },
      required: ['mount_point'],
    },
  },
};

export function validateDocListBlobsInput(input: unknown): input is DocListBlobsInput {
  if (typeof input !== 'object' || input === null) return false;
  const o = input as Record<string, unknown>;
  return (
    typeof o.mount_point === 'string' &&
    (o.folder === undefined || typeof o.folder === 'string')
  );
}

export interface DocListBlobsInput {
  mount_point: string;
  folder?: string;
}

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
