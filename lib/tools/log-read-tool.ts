/**
 * Log Read Tool Definition
 *
 * Reads log entries by conversation, by author, and/or by a span of time —
 * any combination, all optional — newest first. Results come back as JSON.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { llmNumber } from './llm-number'
import { DEFAULT_LOG_RESULT_LIMIT, MAX_LOG_RESULT_LIMIT } from './log-grep-tool'

/** An ISO-8601 instant or date, as a model would write one. */
const instant = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'must be an ISO-8601 date or date-time' })

/** A calendar date with no time, e.g. "2026-10-19". */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The stored-form instant a `from` / `to` bound stands for. A bare date is a
 * whole UTC day: `from` its first millisecond, `to` its last — so
 * `from: "2026-10-19", to: "2026-10-19"` reads that entire day.
 */
export function logReadBoundInstant(value: string, end: 'from' | 'to'): string {
  if (end === 'to' && BARE_DATE.test(value)) return `${value}T23:59:59.999Z`
  return new Date(value).toISOString()
}

/**
 * Zod schema for the log_read tool's input.
 */
export const logReadToolInputSchema = z
  .object({
    conversationId: z
      .string()
      .min(1)
      .optional()
      .describe('Only entries written from this conversation. Use "current" for this one.'),
    character: z
      .string()
      .min(1)
      .optional()
      .describe('Only entries written by this character, by name (case-insensitive) or id.'),
    from: instant
      .optional()
      .describe('Only entries written at or after this moment (ISO-8601, e.g. "2026-10-01" or "2026-10-01T18:00:00Z").'),
    to: instant
      .optional()
      .describe('Only entries written at or before this moment (ISO-8601). A bare date means the end of that day (UTC), so from and to may name the same date.'),
    limit: llmNumber(
      z
        .number()
        .int()
        .min(1)
        .max(MAX_LOG_RESULT_LIMIT)
        .describe(`Most entries to return, newest first. Default ${DEFAULT_LOG_RESULT_LIMIT}.`)
    ).optional(),
  })
  .refine((input) => !input.from || !input.to || logReadBoundInstant(input.from, 'from') <= logReadBoundInstant(input.to, 'to'), {
    message: 'from must not be after to',
    path: ['from'],
  })

export type LogReadToolInput = z.infer<typeof logReadToolInputSchema>

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const logReadToolDefinition = {
  type: 'function',
  function: {
    name: 'log_read',
    description:
      'Read entries from the log, filtered by any combination of conversation, author character, and a span of time; with no filters, the latest entries from everywhere. Returns the entries as JSON, newest first, each with its id, message, conversationId, characterId, characterName and createdAt.',
    parameters: zodToOpenAISchema(logReadToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateLogReadInput(input: unknown): LogReadToolInput | null {
  const parsed = logReadToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
