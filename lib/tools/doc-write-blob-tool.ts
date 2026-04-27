/**
 * @fileoverview Tool definition for writing binary blob assets (images first)
 * into a document store. Accepts base64-encoded bytes; the server transcodes
 * images to WebP via sharp before storing in doc_mount_blobs.
 */

export const docWriteBlobTool = {
  type: 'function',
  function: {
    name: 'doc_write_blob',
    description:
      'Upload a binary asset (image) into a document store. Accepts base64-encoded bytes and stores them in the mount-index database (SQLCipher-encrypted). Images are transcoded to WebP automatically. Use the returned relative_path in Markdown references like ![alt](images/my-pic.webp).',
    parameters: {
      type: 'object',
      properties: {
        mount_point: {
          type: 'string',
          description: 'Mount point name or ID that should receive the blob.',
        },
        path: {
          type: 'string',
          description:
            'Desired relative path within the mount point, e.g. "images/avatar.png". If the upload is transcoded to WebP the extension is rewritten to .webp.',
        },
        data_base64: {
          type: 'string',
          description: 'Base64-encoded bytes of the asset to upload.',
        },
        original_filename: {
          type: 'string',
          description: 'Original filename as the user provided it. Preserved as metadata.',
        },
        mime_type: {
          type: 'string',
          description: 'MIME type of the uploaded bytes (e.g. image/png, image/jpeg).',
        },
        description: {
          type: 'string',
          description:
            'Optional human-authored description / transcript of the asset. Consumed by the embedding pipeline so the blob becomes searchable.',
        },
      },
      required: ['mount_point', 'path', 'data_base64', 'original_filename', 'mime_type'],
    },
  },
};

export function validateDocWriteBlobInput(input: unknown): input is DocWriteBlobInput {
  if (typeof input !== 'object' || input === null) return false;
  const o = input as Record<string, unknown>;
  return (
    typeof o.mount_point === 'string' &&
    typeof o.path === 'string' &&
    typeof o.data_base64 === 'string' &&
    typeof o.original_filename === 'string' &&
    typeof o.mime_type === 'string' &&
    (o.description === undefined || typeof o.description === 'string')
  );
}

export interface DocWriteBlobInput {
  mount_point: string;
  path: string;
  data_base64: string;
  original_filename: string;
  mime_type: string;
  description?: string;
}

export interface DocWriteBlobOutput {
  success: boolean;
  mount_point: string;
  /** Final path the blob is stored under (may differ from input when transcoded). */
  relative_path: string;
  size_bytes: number;
  stored_mime_type: string;
  sha256: string;
}
