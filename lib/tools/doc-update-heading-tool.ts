/**
 * @fileoverview Tool definition for replacing content under specific headings in markdown files.
 * By default preserves subheadings; can optionally replace entire section including subheadings.
 * Supports disambiguation by heading level when heading text appears multiple times.
 */

export const docUpdateHeadingTool = {
  type: 'function',
  function: {
    name: 'doc_update_heading',
    description:
      'Replace all content under a specific heading in a markdown file. By default, preserves subheadings and only replaces content before the first subheading. Set preserve_subheadings to false to replace the entire section including subheadings.',
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
        heading: {
          type: 'string',
          description:
            'Heading text without # markers. For example, "Character Backstory" for the heading "## Character Backstory".',
        },
        content: {
          type: 'string',
          description: 'New content to place under the heading. Can be empty to clear the section.',
        },
        level: {
          type: 'integer',
          minimum: 1,
          maximum: 6,
          description:
            'Heading level (1-6) if the heading text is ambiguous. Use this to disambiguate when the same heading text appears at different levels.',
        },
        preserve_subheadings: {
          type: 'boolean',
          default: true,
          description:
            'If true (default), only replace content before the first subheading. If false, replace the entire section including subheadings.',
        },
      },
      required: ['path', 'heading', 'content'],
    },
  },
};

/**
 * Validates input for doc_update_heading tool.
 */
export function validateDocUpdateHeadingInput(input: unknown): input is DocUpdateHeadingInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // path, heading, and content are required
  if (typeof obj.path !== 'string' || typeof obj.heading !== 'string' || typeof obj.content !== 'string') {
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

  // preserve_subheadings must be boolean if provided
  if (obj.preserve_subheadings !== undefined && typeof obj.preserve_subheadings !== 'boolean') {
    return false;
  }

  return true;
}

export interface DocUpdateHeadingInput {
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  path: string;
  heading: string;
  content: string;
  level?: number;
  preserve_subheadings?: boolean;
}

export interface DocUpdateHeadingOutput {
  success: boolean;
  path: string;
  mtime: number;
}
