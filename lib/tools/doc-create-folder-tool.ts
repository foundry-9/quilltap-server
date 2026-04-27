/**
 * @fileoverview Tool definition for creating folders in document stores, projects, and general files.
 * Creates parent directories as needed (like mkdir -p). Idempotent — succeeds if folder already exists.
 *
 * Scriptorium Phase 3.4
 */

export const docCreateFolderTool = {
  type: 'function',
  function: {
    name: 'doc_create_folder',
    description:
      'Create a new folder in a document store, project files, or general files. Creates parent folders automatically. Succeeds silently if the folder already exists.',
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
          description: 'Relative path for the folder to create within the selected scope.',
        },
      },
      required: ['path'],
    },
  },
};

/**
 * Validates input for doc_create_folder tool.
 */
export function validateDocCreateFolderInput(input: unknown): input is DocCreateFolderInput {
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

export interface DocCreateFolderInput {
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  path: string;
}

export interface DocCreateFolderOutput {
  success: boolean;
  path: string;
}
