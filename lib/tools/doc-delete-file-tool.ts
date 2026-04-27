/**
 * @fileoverview Tool definition for deleting files from document stores, projects, and general files.
 * Permanently deletes the file (no trash/recycle bin).
 *
 * Scriptorium Phase 3.4
 */

export const docDeleteFileTool = {
  type: 'function',
  function: {
    name: 'doc_delete_file',
    description:
      'Permanently delete a file from a document store, project files, or general files. This action cannot be undone — confirm intent before calling.',
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
          description: 'Relative path to the file to delete within the selected scope.',
        },
      },
      required: ['path'],
    },
  },
};

/**
 * Validates input for doc_delete_file tool.
 */
export function validateDocDeleteFileInput(input: unknown): input is DocDeleteFileInput {
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

  return true;
}

export interface DocDeleteFileInput {
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  path: string;
}

export interface DocDeleteFileOutput {
  success: boolean;
  path: string;
}
