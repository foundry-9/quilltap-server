/**
 * Log Grep Tool Definition
 *
 * Searches every log entry in the instance by a JavaScript regular
 * expression, newest first. Results come back as JSON.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { llmNumber } from './llm-number'

/** Longest pattern the tool accepts. */
export const MAX_LOG_GREP_PATTERN_LENGTH = 500

/** Default and ceiling for the number of entries returned. */
export const DEFAULT_LOG_RESULT_LIMIT = 50
export const MAX_LOG_RESULT_LIMIT = 200

/**
 * Zod schema for the log_grep tool's input.
 */
export const logGrepToolInputSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .max(MAX_LOG_GREP_PATTERN_LENGTH)
    .describe(
      'A JavaScript regular expression matched against each entry\'s message, e.g. "lock(pick|smith)" or "^Day \\\\d+". A plain word matches anywhere in the message.'
    ),
  ignore_case: z.boolean().optional().describe('Match without regard to case. Default false.'),
  limit: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .max(MAX_LOG_RESULT_LIMIT)
      .describe(`Most entries to return, newest first. Default ${DEFAULT_LOG_RESULT_LIMIT}.`)
  ).optional(),
})

export type LogGrepToolInput = z.infer<typeof logGrepToolInputSchema>

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const logGrepToolDefinition = {
  type: 'function',
  function: {
    name: 'log_grep',
    description:
      'Search the log (every conversation, every character) for entries whose message matches a regular expression. Returns the matching entries as JSON, newest first, each with its id, message, conversationId, characterId, characterName and createdAt.',
    parameters: zodToOpenAISchema(logGrepToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateLogGrepInput(input: unknown): LogGrepToolInput | null {
  const parsed = logGrepToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/** What this tool does to the world: reads, changes nothing. */
export const logGrepToolEffect: ToolEffectSpec = 'read';
