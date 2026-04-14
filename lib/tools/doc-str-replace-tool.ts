/**
 * @fileoverview Tool definition for finding and replacing exact text in files.
 * The find text must be unique within the file — operations fail if the pattern
 * appears zero times or multiple times. This is the primary editing tool for precise changes.
 */

export const docStrReplaceTool = {
  type: 'function',
  function: {
    name: 'doc_str_replace',
    description:
      'Find and replace exact text in a file. The find text MUST be unique within the file — if it appears zero times or more than once, the operation fails with an error. Include enough surrounding context in the find text to make it unique. This is the primary editing tool: read the file first, identify what to change, then call this tool with enough context for a unique match.',
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
          description: 'Relative path to the file within the selected scope.',
        },
        find: {
          type: 'string',
          description:
            'Exact text to find in the file. Must be unique — appears exactly once. Include sufficient context to guarantee uniqueness.',
        },
        replace: {
          type: 'string',
          description: 'Text to replace the find text with. Can be empty string for deletion.',
        },
        case_sensitive: {
          type: 'boolean',
          default: true,
          description: 'Whether the find text matching is case-sensitive. Default is true.',
        },
        normalize_diacritics: {
          type: 'boolean',
          default: true,
          description:
            'Normalize Unicode diacritics for matching (e.g., "Nimue" matches "Nimuë"). Default is true.',
        },
      },
      required: ['path', 'find', 'replace'],
    },
  },
};

/**
 * Validates input for doc_str_replace tool.
 */
export function validateDocStrReplaceInput(input: unknown): input is DocStrReplaceInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // path, find, and replace are required
  if (
    typeof obj.path !== 'string' ||
    typeof obj.find !== 'string' ||
    typeof obj.replace !== 'string'
  ) {
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

  // case_sensitive must be boolean if provided
  if (obj.case_sensitive !== undefined && typeof obj.case_sensitive !== 'boolean') {
    return false;
  }

  // normalize_diacritics must be boolean if provided
  if (obj.normalize_diacritics !== undefined && typeof obj.normalize_diacritics !== 'boolean') {
    return false;
  }

  return true;
}

export interface DocStrReplaceInput {
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  path: string;
  find: string;
  replace: string;
  case_sensitive?: boolean;
  normalize_diacritics?: boolean;
}

export interface DocStrReplaceOutput {
  success: boolean;
  path: string;
  mtime: number;
  line_number: number;
}
