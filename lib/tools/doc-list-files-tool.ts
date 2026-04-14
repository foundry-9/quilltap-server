/**
 * @fileoverview Tool definition for listing files available in document stores and project files.
 * Without parameters, lists all files across all linked mount points and project files.
 * Supports filtering by mount point, scope, folder, and glob patterns.
 */

export const docListFilesTool = {
  type: 'function',
  function: {
    name: 'doc_list_files',
    description:
      'List files available in document stores and project files. Without parameters, lists all files across all linked mount points and project files.',
    parameters: {
      type: 'object',
      properties: {
        mount_point: {
          type: 'string',
          description:
            'Optional: restrict listing to a specific mount point. Without this, lists all mount points.',
        },
        scope: {
          type: 'string',
          enum: ['document_store', 'project', 'general'],
          description:
            'Optional: restrict to files in a specific scope. "document_store" for mounted stores, "project" for project files, "general" for general files.',
        },
        folder: {
          type: 'string',
          description:
            'Optional: list files within a specific subfolder path. Allows exploring directory structure.',
        },
        pattern: {
          type: 'string',
          description:
            'Optional: glob pattern to filter results (e.g., "*.md", "*.{ts,tsx}", "src/**/*.js").',
        },
        recursive: {
          type: 'boolean',
          default: true,
          description: 'Include files in subfolders. Default is true.',
        },
      },
      required: [],
    },
  },
};

/**
 * Validates input for doc_list_files tool.
 */
export function validateDocListFilesInput(input: unknown): input is DocListFilesInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // mount_point must be string if provided
  if (obj.mount_point !== undefined && typeof obj.mount_point !== 'string') {
    return false;
  }

  // scope must be valid enum if provided
  if (obj.scope !== undefined) {
    if (typeof obj.scope !== 'string' || !['document_store', 'project', 'general'].includes(obj.scope)) {
      return false;
    }
  }

  // folder must be string if provided
  if (obj.folder !== undefined && typeof obj.folder !== 'string') {
    return false;
  }

  // pattern must be string if provided
  if (obj.pattern !== undefined && typeof obj.pattern !== 'string') {
    return false;
  }

  // recursive must be boolean if provided
  if (obj.recursive !== undefined && typeof obj.recursive !== 'boolean') {
    return false;
  }

  return true;
}

export interface DocListFilesInput {
  mount_point?: string;
  scope?: 'document_store' | 'project' | 'general';
  folder?: string;
  pattern?: string;
  recursive?: boolean;
}

export interface DocFileInfo {
  path: string;
  mount_point?: string;
  scope: 'document_store' | 'project' | 'general';
  size: number;
  modified: number;
}

export interface DocListFilesOutput {
  files: DocFileInfo[];
  total: number;
}
