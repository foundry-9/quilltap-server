/**
 * Search Scriptorium Tool Definition
 * Project Scriptorium Phase 2
 *
 * Provides a unified search tool for LLMs to search across character
 * memories and conversation history simultaneously.
 */

/**
 * Input parameters for the search scriptorium tool
 */
export interface SearchScriptoriumToolInput {
  query: string
  sources?: ('memories' | 'conversations')[]
  limit?: number
  minImportance?: number
}

/**
 * Individual search result from any source
 */
export interface SearchScriptoriumResult {
  content: string
  sourceType: 'memory' | 'conversation'
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
    name: 'search_scriptorium',
    description:
      'Search across your memories and past conversation history. Returns results from both your personal memories and rendered conversations, ranked by relevance. Use this to find information from past interactions, recall conversation details, or locate specific discussions by topic.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to search for across memories and conversations. Be specific about the topic, event, or detail you want to find.',
          minLength: 1,
          maxLength: 500,
        },
        sources: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['memories', 'conversations'],
          },
          description:
            'Which sources to search. Defaults to all sources if not specified.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Maximum number of results to return across all sources. Default is 10.',
          default: 10,
        },
        minImportance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Minimum importance score (0-1) for memory results. Only affects memory search, not conversations. Default is 0.',
          default: 0,
        },
      },
      required: ['query'],
    },
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateSearchScriptoriumInput(
  input: unknown
): input is SearchScriptoriumToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }

  const obj = input as Record<string, unknown>

  // query is required
  if (typeof obj.query !== 'string' || obj.query.trim().length === 0) {
    return false
  }

  // Optional sources
  if (obj.sources !== undefined) {
    if (!Array.isArray(obj.sources)) {
      return false
    }
    const validSources = ['memories', 'conversations']
    for (const s of obj.sources) {
      if (typeof s !== 'string' || !validSources.includes(s)) {
        return false
      }
    }
  }

  // Optional limit
  if (obj.limit !== undefined) {
    const limit = Number(obj.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      return false
    }
  }

  // Optional minImportance
  if (obj.minImportance !== undefined) {
    const importance = Number(obj.minImportance)
    if (isNaN(importance) || importance < 0 || importance > 1) {
      return false
    }
  }

  return true
}
