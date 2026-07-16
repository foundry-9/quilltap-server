/**
 * Memory Search Tool Definition
 * Sprint 6: Memory Deep-Dive Tool
 *
 * Provides a tool interface for LLMs to search character memories
 * during conversations. This allows the LLM to explicitly request
 * memory lookup when it needs more information about past interactions.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { llmNumber } from './llm-number'

/**
 * Zod schema for the memory search tool's input.
 */
export const memorySearchToolInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'What to search for in your memories. Be specific about the topic, person, event, or detail you want to recall. Examples: "user\'s favorite food", "their birthday", "what happened last time we talked about work", "their pet\'s name"'
    ),
  limit: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .max(20)
      .describe('Maximum number of memories to retrieve. Default is 5.')
  )
    .default(5)
    .optional(),
  minImportance: llmNumber(
    z
      .number()
      .min(0)
      .max(1)
      .describe(
        'Minimum importance score (0-1) for returned memories. Higher values return only the most important memories. Default is 0.'
      )
  )
    .default(0)
    .optional(),
})

/**
 * Input parameters for the memory search tool
 */
export type MemorySearchToolInput = z.infer<typeof memorySearchToolInputSchema>

/**
 * Result of a memory search
 */
export interface MemorySearchResult {
  id: string
  summary: string
  content: string
  importance: number
  relevanceScore: number
  effectiveWeight?: number
  createdAt: string
  source: 'AUTO' | 'MANUAL'
}

/**
 * Output from the memory search tool
 */
export interface MemorySearchToolOutput {
  success: boolean
  memories?: MemorySearchResult[]
  error?: string
  totalFound: number
  query: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const memorySearchToolDefinition = {
  type: 'function',
  function: {
    name: 'search',
    description:
      'Search the Scriptorium (memories, past conversations, and story backgrounds) for specific information about the user, past conversations, or facts you should remember. Use this when you need to recall details about past interactions, user preferences, important events, or anything you have previously learned about the user. This helps you provide more personalized and contextually aware responses.',
    parameters: zodToOpenAISchema(memorySearchToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateMemorySearchInput(
  input: unknown
): input is MemorySearchToolInput {
  return memorySearchToolInputSchema.safeParse(input).success
}
