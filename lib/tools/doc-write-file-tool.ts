/**
 * @fileoverview Tool definition for writing file contents to document stores, projects, and general files.
 * Replaces entire file contents. Supports optimistic concurrency control via expected_mtime
 * for safer editing workflows with conflict detection.
 */

export const docWriteFileTool = {
  type: 'function',
  function: {
    name: 'doc_write_file',
    description:
      'Write or create a file in a document store, project files, or general files. Replaces the entire file contents. Use expected_mtime for optimistic concurrency when editing existing files.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['document_store', 'project', 'general'],
          default: 'document_store',
          description:
            'The file destination scope. "document_store" writes to mounted document stores, "project" writes to project files, "general" writes to general files.',
        },
        mount_point: {
          type: 'string',
          description: 'Mount point name. Required when scope is "document_store".',
        },
        path: {
          type: 'string',
          description: 'Relative path to the file within the selected scope.',
        },
        content: {
          description: 'The complete new contents for the file. For JSON/JSONL files, can be a string (validated) or a native object/array (serialized).',
        },
        mime_type: {
          type: 'string',
          description: 'Optional MIME type hint; extension detection takes precedence if absent.',
        },
        expected_mtime: {
          type: 'number',
          description:
            'Expected modification time from a previous read. If the file has been modified since this time, the write is rejected to prevent overwriting concurrent changes.',
        },
      },
      required: ['path', 'content'],
    },
  },
};

/**
 * Validates input for doc_write_file tool.
 */
export function validateDocWriteFileInput(input: unknown): input is DocWriteFileInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // path is required; content can be string or any other type
  if (typeof obj.path !== 'string' || obj.content === undefined) {
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

  // mime_type must be string if provided
  if (obj.mime_type !== undefined && typeof obj.mime_type !== 'string') {
    return false;
  }

  // expected_mtime must be number if provided
  if (obj.expected_mtime !== undefined && typeof obj.expected_mtime !== 'number') {
    return false;
  }

  return true;
}

export interface DocWriteFileInput {
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  path: string;
  content: string | unknown;
  mime_type?: string;
  expected_mtime?: number;
}

export interface DocWriteFileOutput {
  success: boolean;
  path: string;
  mtime: number;
}
