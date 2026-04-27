/**
 * @fileoverview Tool definition for searching text across files in document stores and project files.
 * Searches all available sources including mounted document stores and project files.
 * Returns matches with file paths, line numbers, and optional context.
 */

export const docGrepTool = {
  type: 'function',
  function: {
    name: 'doc_grep',
    description:
      'Search for text across files in document stores and project files. Returns matching lines with file paths and line numbers. Searches all mount points linked to the current project plus project files.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search string or regex pattern to find.',
        },
        path: {
          type: 'string',
          description:
            'Optional: restrict search to a specific file or folder path. If a folder, searches recursively.',
        },
        mount_point: {
          type: 'string',
          description:
            'Optional: restrict search to a specific mount point. Without this, searches all mounted points.',
        },
        is_regex: {
          type: 'boolean',
          default: false,
          description: 'Treat query as a regular expression rather than literal text.',
        },
        case_sensitive: {
          type: 'boolean',
          default: false,
          description: 'Case-sensitive matching. Default is case-insensitive.',
        },
        normalize_diacritics: {
          type: 'boolean',
          default: true,
          description:
            'Normalize Unicode diacritics for matching (e.g., "Nimue" matches "Nimuë"). Default is true.',
        },
        context_lines: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Number of lines of context to include before and after each match.',
        },
        max_results: {
          type: 'integer',
          minimum: 1,
          default: 100,
          description: 'Maximum number of matching lines to return.',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * Validates input for doc_grep tool.
 */
export function validateDocGrepInput(input: unknown): input is DocGrepInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // query is required
  if (typeof obj.query !== 'string') {
    return false;
  }

  // path must be string if provided
  if (obj.path !== undefined && typeof obj.path !== 'string') {
    return false;
  }

  // mount_point must be string if provided
  if (obj.mount_point !== undefined && typeof obj.mount_point !== 'string') {
    return false;
  }

  // is_regex must be boolean if provided
  if (obj.is_regex !== undefined && typeof obj.is_regex !== 'boolean') {
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

  // context_lines must be non-negative integer if provided
  if (obj.context_lines !== undefined) {
    if (typeof obj.context_lines !== 'number' || !Number.isInteger(obj.context_lines) || obj.context_lines < 0) {
      return false;
    }
  }

  // max_results must be positive integer if provided
  if (obj.max_results !== undefined) {
    if (typeof obj.max_results !== 'number' || !Number.isInteger(obj.max_results) || obj.max_results < 1) {
      return false;
    }
  }

  return true;
}

export interface DocGrepInput {
  query: string;
  path?: string;
  mount_point?: string;
  is_regex?: boolean;
  case_sensitive?: boolean;
  normalize_diacritics?: boolean;
  context_lines?: number;
  max_results?: number;
}

export interface DocGrepMatch {
  path: string;
  mount_point?: string;
  line_number: number;
  match: string;
  context_before?: string[];
  context_after?: string[];
}

export interface DocGrepOutput {
  matches: DocGrepMatch[];
  total_matches: number;
}
