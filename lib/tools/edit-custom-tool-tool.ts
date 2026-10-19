/**
 * Edit Custom Tool Definition (Pascal's table)
 *
 * Writes, or merely checks, one custom-tool definition — a `Tools/*.tool.json`
 * file at the top level of a document store. Every save is schema-validated
 * first with the same judgement the roster applies at load time, so a file
 * this tool accepts is a file `run_custom` can deal. Called without `content`
 * it writes nothing and only validates the file as it stands — the check to
 * run after editing a definition with the `doc_*` tools.
 *
 * The Zod schema is the single source of truth for both runtime validation and
 * the derived OpenAI-format `parameters`.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const editCustomToolInputSchema = z.object({
  mount_point: z
    .string()
    .min(1)
    .describe(
      'Name of the document store holding the definition. The reserved value "self" addresses your own character vault.'
    ),
  file: z
    .string()
    .min(1)
    .describe(
      'The definition\'s file name, with or without its ".tool.json" suffix (e.g. "unlock" or "unlock.tool.json"). It always lives directly inside the store\'s top-level Tools/ folder; no other folder is accepted.'
    ),
  content: z
    .unknown()
    .optional()
    .describe(
      'The complete new definition, as a JSON string or a native object. It is schema-validated before anything is written, and an invalid definition is not saved. Omit it to save nothing and only validate the file as it stands — for instance after editing it with another tool.'
    ),
});

export type EditCustomToolInput = z.infer<typeof editCustomToolInputSchema>;

export interface EditCustomToolOutput {
  success: boolean;
  /** 'saved' when content was written, 'validated' for a check-only call. */
  action?: 'saved' | 'validated';
  /** Store-relative path of the definition, `Tools/<name>.tool.json`. */
  path?: string;
  /** Canonical qtap:// URI of the definition. */
  uri?: string;
  /** The `name` the definition declares — what `run_custom` calls it by. */
  name?: string;
  error?: string;
}

export const editCustomToolToolDefinition = {
  type: 'function',
  function: {
    name: 'edit_custom_tool',
    description: [
      'Create, replace, or validate one of Pascal\'s custom tools: a Tools/<name>.tool.json definition at the top level of a document store.',
      'With `content`, the definition is schema-validated and saved only if it passes; the error explains what to fix.',
      'Without `content`, nothing is written: the file as it stands is validated — use this after editing a definition with another tool.',
      'A store may not hold two definitions with the same `name`. A saved tool is available to run_custom from the next turn.',
    ].join(' '),
    parameters: zodToOpenAISchema(editCustomToolInputSchema),
  },
};

export function validateEditCustomToolInput(input: unknown): EditCustomToolInput | null {
  const parsed = editCustomToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
