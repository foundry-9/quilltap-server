/**
 * Edit Custom Tool Definition (Pascal's table)
 *
 * Writes, or merely checks, one custom-tool definition — a `Tools/*.tool.json`
 * file at the top level of a document store. Every save is schema-validated
 * first with the same judgement the roster applies at load time, so a file
 * this tool accepts is a file `run_custom` can deal. Called without `content`
 * it writes nothing and only validates the file as it stands — the check to
 * run after editing a definition with the `doc_*` tools. With
 * `action: "schema"` it touches no store at all and returns the definition
 * format itself — the published JSON Schema and worked specimens — so a model
 * can write a tool from scratch.
 *
 * The Zod schema is the single source of truth for both runtime validation and
 * the derived OpenAI-format `parameters`.
 */

import { computedToolEffect, type ToolEffectSpec } from './effect-types';
import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';

export const editCustomToolInputSchema = z
  .object({
    action: z
      .enum(['schema'])
      .optional()
      .describe(
        'Set to "schema" to fetch the custom-tool definition format — the full JSON Schema plus worked example definitions — instead of saving or validating anything. No other field is needed or read. Omit it to save (with `content`) or validate (without).'
      ),
    mount_point: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Name of the document store holding the definition. The reserved value "self" addresses your own character vault. Required unless `action` is "schema".'
      ),
    file: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The definition\'s file name, with or without its ".tool.json" suffix (e.g. "unlock" or "unlock.tool.json"). It always lives directly inside the store\'s top-level Tools/ folder; no other folder is accepted. Required unless `action` is "schema".'
      ),
    content: z
      .unknown()
      .optional()
      .describe(
        'The complete new definition, as a JSON string or a native object. It is schema-validated before anything is written, and an invalid definition is not saved. Omit it to save nothing and only validate the file as it stands — for instance after editing it with another tool.'
      ),
  })
  .refine((input) => input.action === 'schema' || (input.mount_point !== undefined && input.file !== undefined), {
    message: '`mount_point` and `file` are required unless `action` is "schema".',
  });

export type EditCustomToolInput = z.infer<typeof editCustomToolInputSchema>;

export interface EditCustomToolOutput {
  success: boolean;
  /**
   * 'saved' when content was written, 'validated' for a check-only call,
   * 'schema' when the definition format itself was fetched.
   */
  action?: 'saved' | 'validated' | 'schema';
  /** Store-relative path of the definition, `Tools/<name>.tool.json`. */
  path?: string;
  /** Canonical qtap:// URI of the definition. */
  uri?: string;
  /** The `name` the definition declares — what `run_custom` calls it by. */
  name?: string;
  /** The published custom-tool JSON Schema (`action: 'schema'` only). */
  schema?: unknown;
  /** Worked specimen definitions that pass the schema (`action: 'schema'` only). */
  examples?: unknown[];
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
      'With `action: "schema"`, nothing is read or written: the full definition format (JSON Schema and worked examples) is returned — fetch it before writing a tool from scratch.',
      'A store may not hold two definitions with the same `name`. A saved tool is available to run_custom from the next turn.',
    ].join(' '),
    parameters: zodToOpenAISchema(editCustomToolInputSchema),
  },
};

export function validateEditCustomToolInput(input: unknown): EditCustomToolInput | null {
  const parsed = editCustomToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/**
 * What this tool does to the world: `action: "schema"` touches nothing; a
 * call without `content` validates (a read); a call with `content` saves.
 */
export const editCustomToolToolEffect: ToolEffectSpec = computedToolEffect({
  schema: editCustomToolInputSchema,
  resolve: (input) => (input.action === 'schema' ? 'none' : input.content === undefined ? 'read' : 'write'),
  maxEffect: 'write',
  notes: {
    none: 'This turn allows only `action: "schema"`.',
    read: 'This turn allows only `action: "schema"` and validation (no `content`); saving will be refused.',
  },
});
