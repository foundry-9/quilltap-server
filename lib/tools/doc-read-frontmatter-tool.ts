/**
 * @fileoverview Tool definition for reading YAML frontmatter from markdown files.
 * Extracts frontmatter as structured data with optional filtering to specific keys.
 * Returns parsed frontmatter with the file path for reference.
 */

export const docReadFrontmatterTool = {
  type: 'function',
  function: {
    name: 'doc_read_frontmatter',
    description:
      'Read YAML frontmatter from a markdown file. Returns the frontmatter as structured data. Optionally specify keys to retrieve only specific properties. If no frontmatter block exists, returns null.',
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
          description: 'Relative path to the markdown file within the selected scope.',
        },
        keys: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Specific frontmatter keys to retrieve. If omitted, returns all keys.',
        },
      },
      required: ['path'],
    },
  },
};

/**
 * Validates input for doc_read_frontmatter tool.
 */
export function validateDocReadFrontmatterInput(input: unknown): input is DocReadFrontmatterInput {
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

  // keys must be array of strings if provided
  if (obj.keys !== undefined) {
    if (!Array.isArray(obj.keys) || !obj.keys.every((key) => typeof key === 'string')) {
      return false;
    }
  }

  return true;
}

export interface DocReadFrontmatterInput {
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  path: string;
  keys?: string[];
}

export interface DocReadFrontmatterOutput {
  frontmatter: Record<string, unknown> | null;
  path: string;
}
