/**
 * Log Create Entry Tool Definition
 *
 * Lets a character write one line to the instance's log — the ledger that
 * `log_grep` and `log_read` search, and that a custom tool's `log` effect also
 * writes to. The chat and the writing character are stamped from the call's
 * own context, never taken from the model.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { MAX_LOG_ENTRY_MESSAGE_LENGTH } from '@/lib/schemas/log-entry.types'

/**
 * Zod schema for the log_create_entry tool's input.
 */
export const logCreateEntryToolInputSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .max(MAX_LOG_ENTRY_MESSAGE_LENGTH)
    .describe('The line to record, verbatim.'),
})

export type LogCreateEntryToolInput = z.infer<typeof logCreateEntryToolInputSchema>

export interface LogCreateEntryToolOutput {
  success: boolean
  entry?: {
    id: string
    message: string
    conversationId: string
    createdAt: string
  }
  error?: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const logCreateEntryToolDefinition = {
  type: 'function',
  function: {
    name: 'log_create_entry',
    description:
      'Write one line to the log: a durable, timestamped record that you (and other characters) can search later with log_grep or read back with log_read. The entry is recorded against this conversation and you as its author.',
    parameters: zodToOpenAISchema(logCreateEntryToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateLogCreateEntryInput(input: unknown): LogCreateEntryToolInput | null {
  const parsed = logCreateEntryToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/** What this tool does to the world: changes stored state. */
export const logCreateEntryToolEffect: ToolEffectSpec = 'write';
