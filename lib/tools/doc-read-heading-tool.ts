/**
 * @fileoverview Tool definition for reading content under specific headings in markdown files.
 * Returns everything from the specified heading to the next heading of the same or higher level.
 * Supports disambiguation by heading level when heading text appears multiple times.
 */

export const docReadHeadingTool = {
  type: 'function',
  function: {
    name: 'doc_read_heading',
    description:
      'Read all content under a specific heading in a markdown file. Returns everything from the heading to the next heading of the same or higher level. If the heading text is ambiguous (appears multiple times), use the level parameter to disambiguate.',
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
        heading: {
          type: 'string',
          description:
            'Heading text without # markers. For example, "Character Backstory" for the heading "## Character Backstory".',
        },
        level: {
          type: 'integer',
          minimum: 1,
          maximum: 6,
          description:
            'Heading level (1-6) if the heading text is ambiguous. Use this to disambiguate when the same heading text appears at different levels.',
        },
      },
      required: ['path', 'heading'],
    },
  },
};

/**
 * Validates input for doc_read_heading tool.
 */
export function validateDocReadHeadingInput(input: unknown): input is DocReadHeadingInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // path and heading are required
  if (typeof obj.path !== 'string' || typeof obj.heading !== 'string') {
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

  // level must be integer between 1 and 6 if provided
  if (obj.level !== undefined) {
    if (typeof obj.level !== 'number' || !Number.isInteger(obj.level) || obj.level < 1 || obj.level > 6) {
      return false;
    }
  }

  return true;
}

export interface DocReadHeadingInput {
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  path: string;
  heading: string;
  level?: number;
}

export interface DocReadHeadingOutput {
  content: string;
  heading: string;
  level: number;
  path: string;
}
