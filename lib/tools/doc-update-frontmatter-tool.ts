/**
 * @fileoverview Tool definition for updating YAML frontmatter in markdown files.
 * Supports merging updates with existing frontmatter or replacing it entirely.
 * Supports deletion by setting a key to null.
 */

export const docUpdateFrontmatterTool = {
  type: 'function',
  function: {
    name: 'doc_update_frontmatter',
    description:
      'Update or add YAML frontmatter properties in a markdown file. Merges updates with existing frontmatter by default. Use null as a value to delete a key. Creates a frontmatter block if one doesn\'t exist.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['document_store', 'project', 'general'],
          default: 'document_store',
          description:
            'The file source scope. "document_store" operates on mounted document stores, "project" on project files, "general" on general files.',
        },
        mount_point: {
          type: 'string',
          description: 'Mount point name. Required when scope is "document_store".',
        },
        path: {
          type: 'string',
          description: 'Relative path to the markdown file within the selected scope.',
        },
        updates: {
          type: 'object',
          description:
            'Key-value pairs to set or update. Use null as a value to delete a key. Can contain nested objects and arrays.',
        },
        replace_all: {
          type: 'boolean',
          default: false,
          description:
            'If true, replace the entire frontmatter block with updates. If false (default), merge updates with existing frontmatter.',
        },
      },
      required: ['path', 'updates'],
    },
  },
};

/**
 * Validates input for doc_update_frontmatter tool.
 */
export function validateDocUpdateFrontmatterInput(input: unknown): input is DocUpdateFrontmatterInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // path is required
  if (typeof obj.path !== 'string') {
    return false;
  }

  // updates is required and must be an object
  if (typeof obj.updates !== 'object' || obj.updates === null) {
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

  // replace_all must be boolean if provided
  if (obj.replace_all !== undefined && typeof obj.replace_all !== 'boolean') {
    return false;
  }

  return true;
}

export interface DocUpdateFrontmatterInput {
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  path: string;
  updates: Record<string, unknown>;
  replace_all?: boolean;
}

export interface DocUpdateFrontmatterOutput {
  success: boolean;
  path: string;
  mtime: number;
}
