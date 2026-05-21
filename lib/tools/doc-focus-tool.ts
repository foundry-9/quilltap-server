/**
 * @fileoverview Tool definition for focusing the user's attention on a specific location in the open document.
 * This is a UI tool — it scrolls the viewport to the target, highlights text, and places an eye icon in the document gutter.
 * Scriptorium Phase 3.5.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

/**
 * Zod schema for the doc_focus tool's input.
 */
export const docFocusToolInputSchema = z
  .object({
    anchor: z
      .string()
      .describe('Heading text (without # markers) to scroll to. Narrows the search for highlight matching.')
      .optional(),
    highlight: z
      .string()
      .describe('A short text string to find and briefly highlight in the document.')
      .optional(),
    line: z
      .number()
      .describe('Line number to scroll to. Used as fallback when string matching is not viable.')
      .optional(),
    clear_focus: z
      .boolean()
      .describe('If true, removes the attention marker from the gutter. No other parameters needed.')
      .optional(),
  })
  .refine(
    (obj) =>
      obj.anchor !== undefined ||
      obj.highlight !== undefined ||
      obj.line !== undefined ||
      obj.clear_focus === true,
    'At least one parameter must be provided'
  );

/**
 * Input parameters for the doc_focus tool
 */
export type DocFocusInput = z.infer<typeof docFocusToolInputSchema>;

/**
 * Validates input for doc_focus tool.
 */
export function validateDocFocusInput(input: unknown): input is DocFocusInput {
  return docFocusToolInputSchema.safeParse(input).success;
}

export const docFocusToolDefinition = {
  type: 'function',
  function: {
    name: 'doc_focus',
    description:
      "Direct the user's attention to a specific location in the currently open document. Scrolls the viewport to the target, optionally highlights a text passage with a brief animation, and places an eye icon in the document gutter.",
    parameters: zodToOpenAISchema(docFocusToolInputSchema),
  },
};

export interface DocFocusOutput {
  success: boolean;
  anchor?: string;
  highlight?: string;
  line?: number;
  clear_focus?: boolean;
  error?: string;
}
