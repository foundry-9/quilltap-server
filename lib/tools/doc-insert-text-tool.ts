/**
 * @fileoverview Tool definition for inserting text at specific positions in files.
 * Position can be before or after unique anchor text, or at the start/end of a file.
 * The anchor text must be unique within the file if used.
 */

export const docInsertTextTool = {
  type: 'function',
  function: {
    name: 'doc_insert_text',
    description:
      'Insert text at a specific position in a file. Position can be before or after an anchor text (must be unique), or at the start/end of the file.',
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
        position: {
          type: 'object',
          description:
            'Insertion position. Must specify exactly one of: before (string), after (string), or at ("start"|"end").',
          properties: {
            before: {
              type: 'string',
              description:
                'Insert text before this anchor text (must be unique in file).',
            },
            after: {
              type: 'string',
              description:
                'Insert text after this anchor text (must be unique in file).',
            },
            at: {
              type: 'string',
              enum: ['start', 'end'],
              description: 'Insert at the start or end of the file.',
            },
          },
        },
        content: {
          type: 'string',
          description: 'Text to insert at the specified position.',
        },
        normalize_diacritics: {
          type: 'boolean',
          default: true,
          description:
            'Normalize Unicode diacritics when matching anchor text (e.g., "Nimue" matches "Nimuë"). Default is true.',
        },
      },
      required: ['path', 'position', 'content'],
    },
  },
};

/**
 * Validates input for doc_insert_text tool.
 */
export function validateDocInsertTextInput(input: unknown): input is DocInsertTextInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // path and content are required
  if (typeof obj.path !== 'string' || typeof obj.content !== 'string') {
    return false;
  }

  // position is required and must be object
  if (typeof obj.position !== 'object' || obj.position === null) {
    return false;
  }

  const position = obj.position as Record<string, unknown>;

  // position must have exactly one of: before, after, or at
  const positionKeys = Object.keys(position).filter(
    (k) => position[k] !== undefined && position[k] !== null,
  );
  if (positionKeys.length !== 1) {
    return false;
  }

  const posKey = positionKeys[0];
  if (!['before', 'after', 'at'].includes(posKey)) {
    return false;
  }

  // Validate the specific position type
  if (posKey === 'before' || posKey === 'after') {
    if (typeof position[posKey] !== 'string') {
      return false;
    }
  } else if (posKey === 'at') {
    if (typeof position[posKey] !== 'string' || !['start', 'end'].includes(position[posKey] as string)) {
      return false;
    }
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

  // normalize_diacritics must be boolean if provided
  if (obj.normalize_diacritics !== undefined && typeof obj.normalize_diacritics !== 'boolean') {
    return false;
  }

  return true;
}

export interface DocInsertTextInput {
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  path: string;
  position: {
    before?: string;
    after?: string;
    at?: 'start' | 'end';
  };
  content: string;
  normalize_diacritics?: boolean;
}

export interface DocInsertTextOutput {
  success: boolean;
  path: string;
  mtime: number;
  line_number: number;
}
