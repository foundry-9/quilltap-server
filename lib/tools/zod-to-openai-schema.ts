/**
 * Zod → OpenAI-compatible JSON Schema
 *
 * Tool definitions across `lib/tools/*-tool.ts` declare a Zod input schema
 * as the source of truth (`xxxToolInputSchema`). The provider adapters and the
 * simple-json prompt builder consume `parameters` as an inline JSON Schema in
 * the OpenAI tool-call format. This helper derives that JSON Schema from the
 * Zod source so the two cannot drift.
 *
 * Uses Zod 4's native `z.toJSONSchema()` (the deprecated `zod-to-json-schema`
 * package does not support Zod 4 schemas). Strips top-level metadata fields
 * (`$schema`, `$id`, `definitions`, `$defs`) that providers ignore or reject.
 */

import { z } from 'zod'

/**
 * Convert a Zod schema to an OpenAI-compatible inline JSON Schema object.
 *
 * Accepts any Zod type; in practice tool input schemas are always
 * `z.object({...})`, which produces a JSON Schema with `type: 'object'`,
 * `properties`, `required`, and `additionalProperties: false`.
 */
export function zodToOpenAISchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>

  delete raw.$schema
  delete raw.$id
  delete raw.definitions
  delete raw.$defs

  return raw
}
