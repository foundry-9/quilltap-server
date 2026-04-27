/**
 * @fileoverview Tool definition for focusing the user's attention on a specific location in the open document.
 * This is a UI tool — it scrolls the viewport to the target, highlights text, and places an eye icon in the document gutter.
 * Scriptorium Phase 3.5.
 */

export const docFocusTool = {
  type: 'function',
  function: {
    name: 'doc_focus',
    description:
      "Direct the user's attention to a specific location in the currently open document. Scrolls the viewport to the target, optionally highlights a text passage with a brief animation, and places an eye icon in the document gutter.",
    parameters: {
      type: 'object',
      properties: {
        anchor: {
          type: 'string',
          description:
            'Heading text (without # markers) to scroll to. Narrows the search for highlight matching.',
        },
        highlight: {
          type: 'string',
          description:
            'A short text string to find and briefly highlight in the document.',
        },
        line: {
          type: 'number',
          description:
            'Line number to scroll to. Used as fallback when string matching is not viable.',
        },
        clear_focus: {
          type: 'boolean',
          description:
            'If true, removes the attention marker from the gutter. No other parameters needed.',
        },
      },
      required: [],
    },
  },
};

/**
 * Validates input for doc_focus tool.
 */
export function validateDocFocusInput(input: unknown): input is DocFocusInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // anchor must be string if provided
  if (obj.anchor !== undefined && typeof obj.anchor !== 'string') {
    return false;
  }

  // highlight must be string if provided
  if (obj.highlight !== undefined && typeof obj.highlight !== 'string') {
    return false;
  }

  // line must be number if provided
  if (obj.line !== undefined && typeof obj.line !== 'number') {
    return false;
  }

  // clear_focus must be boolean if provided
  if (obj.clear_focus !== undefined && typeof obj.clear_focus !== 'boolean') {
    return false;
  }

  // At least one parameter must be provided
  if (obj.anchor === undefined && obj.highlight === undefined && obj.line === undefined && obj.clear_focus !== true) {
    return false;
  }

  return true;
}

export interface DocFocusInput {
  anchor?: string;
  highlight?: string;
  line?: number;
  clear_focus?: boolean;
}

export interface DocFocusOutput {
  success: boolean;
  anchor?: string;
  highlight?: string;
  line?: number;
  clear_focus?: boolean;
  error?: string;
}
