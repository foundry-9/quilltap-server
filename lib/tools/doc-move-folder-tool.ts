/**
 * @fileoverview Tool definition for moving or renaming folders in document stores.
 * Cascades to all descendant folders and documents. Destination parent is auto-created
 * for database-backed stores (matching mkdir -p semantics).
 *
 * Scriptorium Phase 4.0 Deliverable 3 - Phase B
 */

export const docMoveFolderTool = {
  type: 'function',
  function: {
    name: 'doc_move_folder',
    description:
      'Move or rename a folder in a document store. When moving to a different directory, moves the entire folder and its contents. When renaming within the same directory, renames it. For database-backed stores, the destination parent directory is created automatically if it does not exist (mkdir -p semantics). Will not overwrite an existing folder at the destination.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['document_store'],
          default: 'document_store',
          description: 'The folder scope. Only "document_store" is supported for folder operations.',
        },
        mount_point: {
          type: 'string',
          description: 'Mount point name. Required when scope is "document_store".',
        },
        path: {
          type: 'string',
          description: 'Current relative path to the folder within the selected scope.',
        },
        new_path: {
          type: 'string',
          description: 'Destination relative path for the folder. Parent directories are created automatically for database-backed stores.',
        },
      },
      required: ['path', 'new_path'],
    },
  },
};

/**
 * Validates input for doc_move_folder tool.
 */
export function validateDocMoveFolderInput(input: unknown): input is DocMoveFolderInput {
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
    if (typeof obj.scope !== 'string' || obj.scope !== 'document_store') {
      return false;
    }
  }

  // mount_point must be string if provided
  if (obj.mount_point !== undefined && typeof obj.mount_point !== 'string') {
    return false;
  }

  return true;
}

export interface DocMoveFolderInput {
  scope?: 'document_store';
  mount_point?: string;
  path: string;
  new_path: string;
}

export interface DocMoveFolderOutput {
  success: boolean;
  old_path: string;
  new_path: string;
}
