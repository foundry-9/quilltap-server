/**
 * @fileoverview Tool definition for opening a document in the split-panel Document Mode editor.
 * This is a UI tool — it opens a document alongside the chat for collaborative editing.
 * Scriptorium Phase 3.5.
 */

export const docOpenDocumentTool = {
  type: 'function',
  function: {
    name: 'doc_open_document',
    description:
      'Open a document in the split-panel Document Mode editor alongside the chat. Creates a new blank document if no path is provided, or opens an existing file. The user will see the document in an editor pane next to the chat.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path to the file to open. Omit to create a new blank document.',
        },
        title: {
          type: 'string',
          description:
            'Display title for new blank documents. Ignored if path is provided.',
        },
        scope: {
          type: 'string',
          enum: ['document_store', 'project', 'general'],
          default: 'project',
          description:
            'The file source scope. Only used when path is provided.',
        },
        mount_point: {
          type: 'string',
          description:
            'Mount point name. Required when scope is "document_store".',
        },
        mode: {
          type: 'string',
          enum: ['split', 'focus'],
          default: 'split',
          description:
            'Layout mode. "split" shows chat and document side by side, "focus" maximizes the document editor.',
        },
      },
      required: [],
    },
  },
};

/**
 * Validates input for doc_open_document tool.
 */
export function validateDocOpenDocumentInput(input: unknown): input is DocOpenDocumentInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // path must be string if provided
  if (obj.path !== undefined && typeof obj.path !== 'string') {
    return false;
  }

  // title must be string if provided
  if (obj.title !== undefined && typeof obj.title !== 'string') {
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

  // mode must be valid enum if provided
  if (obj.mode !== undefined) {
    if (typeof obj.mode !== 'string' || !['split', 'focus'].includes(obj.mode)) {
      return false;
    }
  }

  return true;
}

export interface DocOpenDocumentInput {
  path?: string;
  title?: string;
  scope?: 'document_store' | 'project' | 'general';
  mount_point?: string;
  mode?: 'split' | 'focus';
}

export interface DocOpenDocumentOutput {
  success: boolean;
  filePath: string;
  scope: string;
  mountPoint?: string;
  displayTitle: string;
  mode: 'split' | 'focus';
  isNew: boolean;
  mtime?: number;
}
