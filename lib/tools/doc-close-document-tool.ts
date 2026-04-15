/**
 * @fileoverview Tool definition for closing the Document Mode editor pane.
 * This is a UI tool — it closes the document pane and returns to the normal chat layout.
 * Scriptorium Phase 3.5.
 */

export const docCloseDocumentTool = {
  type: 'function',
  function: {
    name: 'doc_close_document',
    description:
      'Close the Document Mode editor pane and return to the normal chat layout. Any pending changes are saved automatically before closing. The document state is cached for the session — reopening the same document does not require a full reload.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description:
            'Optional reason for closing the document. Shown to the user as a system note.',
        },
      },
      required: [],
    },
  },
};

/**
 * Validates input for doc_close_document tool.
 */
export function validateDocCloseDocumentInput(input: unknown): input is DocCloseDocumentInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // reason must be string if provided
  if (obj.reason !== undefined && typeof obj.reason !== 'string') {
    return false;
  }

  return true;
}

export interface DocCloseDocumentInput {
  reason?: string;
}

export interface DocCloseDocumentOutput {
  success: boolean;
  message: string;
}
