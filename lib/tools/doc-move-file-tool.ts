/**
 * @fileoverview Tool definition for moving or renaming files in document stores, projects, and general files.
 * Unified move/rename operation. Does not overwrite existing files.
 *
 * Scriptorium Phase 3.4
 */

export const docMoveFileTool = {
  type: 'function',
  function: {
    name: 'doc_move_file',
    description:
      'Move or rename a file in a document store, project files, or general files. If new_path is in a different directory, moves the file. If in the same directory, renames it. Will not overwrite an existing file at the destination.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['document_store', 'project', 'general'],
          default: 'document_store',
          description:
            'The file scope. "document_store" for mounted document stores, "project" for project files, "general" for general files.',
        },
        mount_point: {
          type: 'string',
          description: 'Mount point name. Required when scope is "document_store".',
        },
        path: {
          type: 'string',
          description: 'Current relative path to the file within the selected scope.',
        },
        new_path: {
          type: 'string',
          description: 'Destination relative path for the file. Parent directories are created automatically.',
        },
      },
      required: ['path', 'new_path'],
    },
  },
};

/**
 * Validates input for doc_move_file tool.
 */
export function validateDocMoveFileInput(input: unknown): input is DocMoveFileInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // path and new_path are required
  if (typeof obj.path !== 'string' || typeof obj.new_path !== 'string') {
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

  return true;
}

export interface DocMoveFileInput {
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  path: string;
  new_path: string;
}

export interface DocMoveFileOutput {
  success: boolean;
  old_path: string;
  new_path: string;
}
