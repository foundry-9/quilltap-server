/**
 * Search Scriptorium Tool Definition
 * Project Scriptorium Phase 2
 *
 * Provides a unified search tool for LLMs to search across character
 * memories and conversation history simultaneously.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Zod schema for the search-scriptorium tool's input.
 */
export const searchScriptoriumToolInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'What to search for across memories, conversations, documents, and your own knowledge base. Be specific about the topic, event, or detail you want to find.'
    ),
  sources: z
    .array(z.enum(['memories', 'conversations', 'documents', 'knowledge']))
    .describe(
      'Which layers to search. Defaults to all sources if not specified. "memories" recalls your personal commonplace-book memories; "conversations" searches rendered transcripts of past chats; "documents" searches every file in every document store within the current `scope`; "knowledge" searches only files under a `Knowledge/` folder inside those same stores. Each knowledge result is tagged with its tier (character, project, or global) so you can tell whose voice it speaks in.'
    )
    .optional(),
  scope: z
    .enum(['all', 'project', 'character'])
    .default('all')
    .describe(
      "Which document stores the `documents` and `knowledge` sources reach into. \"all\" (the default) searches every store you can see — your own character vault, every document store linked to this chat's project, and the instance-wide Quilltap General store. \"project\" narrows to just the document stores linked to this chat's project (returns nothing if no project is attached). \"character\" narrows to just your own character vault. `scope` has no effect on `memories` or `conversations`."
    )
    .optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe('Maximum number of results to return across all sources. Default is 10.')
    .optional(),
  minImportance: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe(
      'Minimum importance score (0-1) for memory results. Only affects memory search, not conversations. Default is 0.'
    )
    .optional(),
})

/**
 * Input parameters for the search scriptorium tool
 */
export type SearchScriptoriumToolInput = z.infer<typeof searchScriptoriumToolInputSchema>

/**
 * Individual search result from any source
 */
export interface SearchScriptoriumResult {
  content: string
  sourceType: 'memory' | 'conversation' | 'document' | 'knowledge'
  relevanceScore: number
  metadata: {
    // Memory-specific
    memoryId?: string
    summary?: string
    importance?: number
    effectiveWeight?: number
    createdAt?: string
    source?: 'AUTO' | 'MANUAL'
    // Conversation-specific
    conversationId?: string
    interchangeIndex?: number
    conversationTitle?: string
    participantNames?: string[]
    // Document-specific
    mountPointName?: string
    fileName?: string
    filePath?: string
    chunkIndex?: number
    headingContext?: string
    // Knowledge-specific
    knowledgeTier?: 'character' | 'project' | 'global'
  }
}

/**
 * Output from the search scriptorium tool
 */
export interface SearchScriptoriumToolOutput {
  success: boolean
  results?: SearchScriptoriumResult[]
  error?: string
  totalFound: number
  query: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const searchScriptoriumToolDefinition = {
  type: 'function',
  function: {
    name: 'search',
    description:
      "Search across your memories, past conversation history, and every document store you can reach. Returns results from your personal memories, rendered conversations, files in your character vault, files in every document store linked to this chat's project, files in the instance-wide Quilltap General store, and — when narrowed to the `knowledge` source — the `Knowledge/` folders inside those same stores. Use `scope` to confine the search to your own vault or to the project pool. Use this to find information from past interactions, recall conversation details, locate specific discussions by topic, search through reference documents, or look up what's been written down — by you, by the project, or by the operator at large.",
    parameters: zodToOpenAISchema(searchScriptoriumToolInputSchema),
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateSearchScriptoriumInput(
  input: unknown
): input is SearchScriptoriumToolInput {
  return searchScriptoriumToolInputSchema.safeParse(input).success
}
