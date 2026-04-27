/**
 * @fileoverview Tool definition for reading file contents from document stores, projects, and general files.
 * Supports pagination via offset and limit for handling large files.
 * Returns file content with metadata including modification time for the read-then-replace workflow.
 */

export const docReadFileTool = {
  type: 'function',
  function: {
    name: 'doc_read_file',
    description:
      'Read the contents of a file from a document store, project files, or general files. Returns the file content with modification time for the read-then-replace workflow. Use offset and limit for large files.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['document_store', 'project', 'general'],
          default: 'document_store',
          description:
            'The file source scope. "document_store" reads from mounted document stores, "project" reads from project files, "general" reads from general files.',
        },
        mount_point: {
          type: 'string',
          description: 'Mount point name. Required when scope is "document_store".',
        },
        path: {
          type: 'string',
          description: 'Relative path to the file within the selected scope.',
        },
        offset: {
          type: 'integer',
          minimum: 1,
          description: 'Start line number (1-based) for pagination. Default is 1.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          description: 'Maximum number of lines to return. Default returns all lines.',
        },
      },
      required: ['path'],
    },
  },
};

/**
 * Validates input for doc_read_file tool.
 */
export function validateDocReadFileInput(input: unknown): input is DocReadFileInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // path is required
  if (typeof obj.path !== 'string') {
    return false;
  }

  // scope must be valid enum if provided
  if (obj.scope !== undefined) {
    if (typeof obj.scope !== 'string' || !['document_store', 'project', 'general'].includes(obj.scope)) {
      return false;
    }
  }

  // mount_point must be string if provided
  if (obj.mount_point !== undefined && typeof obj.mount_point !== 'string') {
    return false;
  }

  // offset must be positive integer if provided
  if (obj.offset !== undefined) {
    if (typeof obj.offset !== 'number' || !Number.isInteger(obj.offset) || obj.offset < 1) {
      return false;
    }
  }

  // limit must be positive integer if provided
  if (obj.limit !== undefined) {
    if (typeof obj.limit !== 'number' || !Number.isInteger(obj.limit) || obj.limit < 1) {
      return false;
    }
  }

  return true;
}

export interface DocReadFileInput {
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  path: string;
  offset?: number;
  limit?: number;
}

export interface DocReadFileOutput {
  content: string | unknown;  // raw string for text/*; parsed value for JSON/JSONL (string on parse failure)
  rawContent?: string;        // always populated for JSON/JSONL reads
  parsed?: boolean;           // true iff JSON/JSONL and parse succeeded (JSONL: true if at least one line parsed)
  parseError?: { message: string; line?: number };
  mimeType?: string;
  path: string;
  mtime: number;
  totalLines: number;
  truncated: boolean;
  // True when content is plain text derived from a binary blob (e.g. pdf/docx
  // extraction) rather than the file's original bytes. The blob's raw bytes
  // remain accessible via the blob read endpoint but are not returned here.
  derivedFromBlob?: boolean;
}
